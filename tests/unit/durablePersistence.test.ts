import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { GameSessionRegistry } from "../../src/composition/registry";
import { toGameState } from "../../src/engine/sessionSnapshot";
import { counts, isSuperset, countsNonDecreasing } from "../../src/domain/saveState";

const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-0030-"));
const USER_A = "user-a";
const USER_B = "user-b";

describe("0030 — durable game persistence (survive engine restart)", () => {
  it("FileSaveStore round-trips a snapshot and isolates users on disk", () => {
    const store = new FileSaveStore(freshDir());
    expect(store.hasSave(USER_A)).toBe(false);
    expect(store.loadLatest(USER_A)).toBeNull();

    const registry = new GameSessionRegistry(store);
    registry.sandboxFor(USER_A).session.createCharacter({ playerName: "Player A", seed: 1 });

    expect(store.hasSave(USER_A)).toBe(true);
    expect(store.hasSave(USER_B)).toBe(false); // a different user has nothing
    const snap = store.loadLatest(USER_A)!;
    expect(snap.started).toBe(true);
    expect(snap.house).not.toBeNull();
  });

  it("a started game survives a restart — a fresh registry resumes it as started", () => {
    const dir = freshDir();
    const before = new GameSessionRegistry(new FileSaveStore(dir));
    const view1 = before.sandboxFor(USER_A).session.createCharacter({ playerName: "Resumer", seed: 7 });
    expect(view1.started).toBe(true);

    // Restart: a brand-new registry + store over the SAME data dir (new-process analogue).
    const after = new GameSessionRegistry(new FileSaveStore(dir));
    const view2 = after.sandboxFor(USER_A).session.getGameState();

    expect(view2.started).toBe(true); // onboarding overlay would NOT re-fire
    expect(view2.week).toBe(view1.week);
    expect(view2.phase).toBe(view1.phase);
    expect(view2.player?.name).toBe(view1.player?.name);
    expect(view2.house.map((h) => h.name)).toEqual(view1.house.map((h) => h.name));
  });

  it("a user with no save still onboards after a restart; per-user isolation holds", () => {
    const dir = freshDir();
    const before = new GameSessionRegistry(new FileSaveStore(dir));
    before.sandboxFor(USER_A).session.createCharacter({ playerName: "Has Game", seed: 3 });
    // USER_B never creates a game.

    const after = new GameSessionRegistry(new FileSaveStore(dir));
    expect(after.sandboxFor(USER_A).session.getGameState().started).toBe(true);
    const bView = after.sandboxFor(USER_B).session.getGameState();
    expect(bView.started).toBe(false); // no save → onboarding
    expect(bView.house).toEqual([]);
  });

  it("two users' games stay distinct across a restart", () => {
    const dir = freshDir();
    const before = new GameSessionRegistry(new FileSaveStore(dir));
    const a1 = before.sandboxFor(USER_A).session.createCharacter({ playerName: "Alpha", seed: 11 });
    const b1 = before.sandboxFor(USER_B).session.createCharacter({ playerName: "Bravo", seed: 22 });
    expect(a1.player?.name).not.toBe(b1.player?.name);

    const after = new GameSessionRegistry(new FileSaveStore(dir));
    const a2 = after.sandboxFor(USER_A).session.getGameState();
    const b2 = after.sandboxFor(USER_B).session.getGameState();
    expect(a2.player?.name).toBe("Alpha");
    expect(b2.player?.name).toBe("Bravo");
    expect(a2.house.map((h) => h.name)).not.toEqual(b2.house.map((h) => h.name)); // different casts
  });

  it("detail does not degrade across a restart (superset, non-decreasing, byte-stable character)", () => {
    const dir = freshDir();
    const before = new GameSessionRegistry(new FileSaveStore(dir));
    const sbA = before.sandboxFor(USER_A);
    sbA.session.createCharacter({ playerName: "Keeper", seed: 5 });
    // Real mutations that fold into events + the hidden relationship layer (0023). The command seam
    // is player-witnessed by rule (E21); off-screen scenes are the engine's to mint.
    sbA.commands.recordInteraction({ initiator: "npc:1", witnessSet: ["npc:1", "player"], content: "a quiet warning", kind: "betrayal" });
    sbA.commands.recordInteraction({ initiator: "player", witnessSet: ["player", "npc:2"], content: "an alliance forms", kind: "alliance" });
    const saved = new FileSaveStore(dir).loadLatest(USER_A)!;

    const after = new GameSessionRegistry(new FileSaveStore(dir));
    after.sandboxFor(USER_A); // resume (re-records events + reloads beliefs)
    after.saveUser(USER_A); // re-export the resumed state
    const resumed = new FileSaveStore(dir).loadLatest(USER_A)!;

    const gsBefore = toGameState(saved);
    const gsAfter = toGameState(resumed);
    expect(isSuperset(gsAfter, gsBefore)).toBe(true); // nothing dropped
    expect(countsNonDecreasing(counts(gsAfter), counts(gsBefore))).toBe(true);
    expect(counts(gsAfter).events).toBeGreaterThanOrEqual(2);
    // The static character baseline is byte-for-byte unchanged across the restart.
    expect(JSON.stringify(resumed.house?.npcs.map((n) => n.character)))
      .toBe(JSON.stringify(saved.house?.npcs.map((n) => n.character)));
  });
});
