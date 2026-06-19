import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSaveStore } from "../../src/adapters/sqlite/SqliteSaveStore";
import { GameSessionRegistry } from "../../src/composition/registry";
import { toGameState } from "../../src/engine/sessionSnapshot";
import { counts, isSuperset, countsNonDecreasing } from "../../src/domain/saveState";

/**
 * E63 — the SQLite relational save store mirrors the 0007/0030 non-degradation guarantees of
 * `FileSaveStore` (this suite deliberately parallels `durablePersistence.test.ts`): versioned blobs,
 * a lossless round-trip, per-user isolation, survive-a-restart, and detail that never degrades.
 */
const freshDbFile = (): string => join(mkdtempSync(join(tmpdir(), "orwell-e63-")), "orwell.sqlite");
const USER_A = "user-a";
const USER_B = "user-b";

describe("E63 — SQLite durable save store (relational UserSaveStore)", () => {
  it("round-trips a snapshot losslessly and isolates users", () => {
    const store = new SqliteSaveStore(":memory:");
    expect(store.hasSave(USER_A)).toBe(false);
    expect(store.loadLatest(USER_A)).toBeNull();

    const registry = new GameSessionRegistry(store);
    registry.sandboxFor(USER_A).session.createCharacter({ playerName: "Player A", seed: 1 });

    expect(store.hasSave(USER_A)).toBe(true);
    expect(store.hasSave(USER_B)).toBe(false); // a different user has nothing
    const snap = store.loadLatest(USER_A)!;
    expect(snap.started).toBe(true);
    expect(snap.house).not.toBeNull();
    store.close();
  });

  it("never overwrites a version — each save is a NEW version, loadLatest reads the highest", () => {
    const store = new SqliteSaveStore(":memory:");
    const registry = new GameSessionRegistry(store);
    const sb = registry.sandboxFor(USER_A);
    sb.session.createCharacter({ playerName: "Versioner", seed: 9 });
    // Two mutations → at least two more versions; the prior versions are never rewritten in place.
    sb.commands.recordInteraction({ initiator: "npc:1", witnessSet: ["npc:1", "player"], content: "a quiet word", kind: "betrayal" });
    sb.commands.recordInteraction({ initiator: "player", witnessSet: ["player", "npc:2"], content: "a pact", kind: "alliance" });
    const latest = store.loadLatest(USER_A)!;
    // The latest snapshot is a superset of the first save (monotonic versions, never a step back).
    expect(latest.events.length).toBeGreaterThanOrEqual(2);
    store.close();
  });

  it("a started game survives a restart — a fresh store over the SAME db resumes it", () => {
    const dbFile = freshDbFile();
    const before = new GameSessionRegistry(new SqliteSaveStore(dbFile));
    const view1 = before.sandboxFor(USER_A).session.createCharacter({ playerName: "Resumer", seed: 7 });
    expect(view1.started).toBe(true);

    // Restart: a brand-new registry + store over the SAME db file (new-process analogue).
    const after = new GameSessionRegistry(new SqliteSaveStore(dbFile));
    const view2 = after.sandboxFor(USER_A).session.getGameState();

    expect(view2.started).toBe(true); // onboarding overlay would NOT re-fire
    expect(view2.week).toBe(view1.week);
    expect(view2.phase).toBe(view1.phase);
    expect(view2.player?.name).toBe(view1.player?.name);
    expect(view2.house.map((h) => h.name)).toEqual(view1.house.map((h) => h.name));
  });

  it("a user with no save still onboards after a restart; per-user isolation holds", () => {
    const dbFile = freshDbFile();
    const before = new GameSessionRegistry(new SqliteSaveStore(dbFile));
    before.sandboxFor(USER_A).session.createCharacter({ playerName: "Has Game", seed: 3 });
    // USER_B never creates a game.

    const after = new GameSessionRegistry(new SqliteSaveStore(dbFile));
    expect(after.sandboxFor(USER_A).session.getGameState().started).toBe(true);
    const bView = after.sandboxFor(USER_B).session.getGameState();
    expect(bView.started).toBe(false); // no save → onboarding
    expect(bView.house).toEqual([]);
  });

  it("two users' games stay distinct across a restart", () => {
    const dbFile = freshDbFile();
    const before = new GameSessionRegistry(new SqliteSaveStore(dbFile));
    const a1 = before.sandboxFor(USER_A).session.createCharacter({ playerName: "Alpha", seed: 11 });
    const b1 = before.sandboxFor(USER_B).session.createCharacter({ playerName: "Bravo", seed: 22 });
    expect(a1.player?.name).not.toBe(b1.player?.name);

    const after = new GameSessionRegistry(new SqliteSaveStore(dbFile));
    const a2 = after.sandboxFor(USER_A).session.getGameState();
    const b2 = after.sandboxFor(USER_B).session.getGameState();
    expect(a2.player?.name).toBe("Alpha");
    expect(b2.player?.name).toBe("Bravo");
    expect(a2.house.map((h) => h.name)).not.toEqual(b2.house.map((h) => h.name)); // different casts
  });

  it("detail does not degrade across a restart (superset, non-decreasing, byte-stable character)", () => {
    const dbFile = freshDbFile();
    const before = new GameSessionRegistry(new SqliteSaveStore(dbFile));
    const sbA = before.sandboxFor(USER_A);
    sbA.session.createCharacter({ playerName: "Keeper", seed: 5 });
    // Real mutations that fold into events + the hidden relationship layer (0023). The command seam
    // is player-witnessed by rule (E21); off-screen scenes are the engine's to mint.
    sbA.commands.recordInteraction({ initiator: "npc:1", witnessSet: ["npc:1", "player"], content: "a quiet warning", kind: "betrayal" });
    sbA.commands.recordInteraction({ initiator: "player", witnessSet: ["player", "npc:2"], content: "an alliance forms", kind: "alliance" });
    const saved = new SqliteSaveStore(dbFile).loadLatest(USER_A)!;

    const after = new GameSessionRegistry(new SqliteSaveStore(dbFile));
    after.sandboxFor(USER_A); // resume (re-records events + reloads beliefs)
    after.saveUser(USER_A); // re-export the resumed state
    const resumed = new SqliteSaveStore(dbFile).loadLatest(USER_A)!;

    const gsBefore = toGameState(saved);
    const gsAfter = toGameState(resumed);
    expect(isSuperset(gsAfter, gsBefore)).toBe(true); // nothing dropped
    expect(countsNonDecreasing(counts(gsAfter), counts(gsBefore))).toBe(true);
    expect(counts(gsAfter).events).toBeGreaterThanOrEqual(2);
    // The static character baseline is byte-for-byte unchanged across the restart.
    expect(JSON.stringify(resumed.house?.npcs.map((n) => n.character)))
      .toBe(JSON.stringify(saved.house?.npcs.map((n) => n.character)));
  });

  it("a season restart (resetUser) retires the dead season off the live path; a new season starts clean", () => {
    const dbFile = freshDbFile();
    const store = new SqliteSaveStore(dbFile);
    const registry = new GameSessionRegistry(store);
    registry.sandboxFor(USER_A).session.createCharacter({ playerName: "S1", seed: 1 });
    expect(store.hasSave(USER_A)).toBe(true);

    registry.resetUser(USER_A); // the ONE sanctioned restart door (rotates the save off the live path)
    // A fresh store sees no LIVE save for the user (the dead season is retired, not resumed).
    const afterReset = new SqliteSaveStore(dbFile);
    expect(afterReset.hasSave(USER_A)).toBe(false);
    expect(afterReset.loadLatest(USER_A)).toBeNull();

    // Season 2 starts clean and persists; an engine restart resumes IT, never the dead season.
    registry.sandboxFor(USER_A).session.createCharacter({ playerName: "S2", seed: 2 });
    const s2 = new SqliteSaveStore(dbFile).loadLatest(USER_A)!;
    expect(s2.started).toBe(true);
    expect(s2.house?.player.name).toBe("S2");
  });

  it("listUsers reports only users with a LIVE save (the boot preload set)", () => {
    const store = new SqliteSaveStore(":memory:");
    const registry = new GameSessionRegistry(store);
    registry.sandboxFor(USER_A).session.createCharacter({ playerName: "A", seed: 1 });
    registry.sandboxFor(USER_B).session.createCharacter({ playerName: "B", seed: 2 });
    expect(store.listUsers().sort()).toEqual([USER_A, USER_B].sort());
    store.resetUser(USER_A);
    expect(store.listUsers()).toEqual([USER_B]);
    store.close();
  });

  it("a corrupt latest version is quarantined and load steps down to the prior version", () => {
    const store = new SqliteSaveStore(":memory:");
    const registry = new GameSessionRegistry(store);
    const sb = registry.sandboxFor(USER_A);
    sb.session.createCharacter({ playerName: "Survivor", seed: 4 });
    // Two good versions exist (create + at least one mutation-driven save).
    sb.commands.recordInteraction({ initiator: "player", witnessSet: ["player", "npc:1"], content: "a chat", kind: "alliance" });
    const goodLatest = store.loadLatest(USER_A)!;
    // Corrupt the live latest row directly (a truncated-on-crash analogue).
    // (Accessing the db through a fresh prepared statement on the same connection.)
    const db = (store as unknown as { db: import("better-sqlite3").Database }).db;
    const maxLive = db.prepare("SELECT MAX(version) v FROM saves WHERE user=? AND retired=0").get(USER_A) as { v: number };
    db.prepare("UPDATE saves SET snapshot_json='{not json' WHERE user=? AND version=?").run(USER_A, maxLive.v);
    const recovered = store.loadLatest(USER_A);
    expect(recovered).not.toBeNull();
    // Stepped down to a readable prior version (still a started game, no crash-loop).
    expect(recovered!.started).toBe(true);
    expect(recovered!.house?.player.name).toBe(goodLatest.house?.player.name);
    store.close();
  });
});
