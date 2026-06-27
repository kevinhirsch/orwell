import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeRuntime } from "../../src/composition/runtime";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { toGameState } from "../../src/engine/sessionSnapshot";
import { isSuperset, type GameState, type PersistedCharacter } from "../../src/domain/saveState";

/**
 * #1067 — the season-start cast deep-profile authoring write-back (`recordCastProfile`, feature 0058)
 * must LAND on the live season without tripping the 0031 fail-closed non-degradation checkpoint.
 *
 * The live-verify (real deepseek) authored only 9/15 cast members; the other 6 were lost to the SAME
 * engine refusal — "turn refused — integrity checkpoint failed (degradation); state unchanged" — and the
 * FE retries from PR #1062 couldn't help because the refusal is DETERMINISTIC, not a transient race:
 *   • the seeded deterministic floor (`seedDeepProfiles`) sets each NPC's PUBLIC `biography` /
 *     `physicalCharacteristics` / `vocation` to a PLACEHOLDER, persisted as the byte-stable Character
 *     baseline at season start;
 *   • the authoring write-back then REPLACES those facets with a richer authored version — which the
 *     `isSuperset` byte-compare reads as a forbidden rewrite of an immutable Character (degradation),
 *     even though it ACCRETES detail;
 *   • a second latent bug: the deep-profile RE-SEAL shared a Vault `kind` ("hidden-attribute") with the
 *     private-orientation record for the same subject, so a `{kind,subject}` replace DROPPED the
 *     orientation — a real Vault non-degradation regression the checkpoint correctly caught.
 *
 * The fix (NOT a weakening of the guard): a one-directional, provenance-flagged floor→authored UPGRADE
 * of the public deep-profile facets (mirrors the 0062 worldSnapshot web_search upgrade) + an id-scoped
 * Vault re-seal that never touches the co-kind orientation. Roles only — no names.
 */
const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-1067-"));

function liveRuntime(dir = freshDir()) {
  return composeRuntime({
    saveStore: new FileSaveStore(dir),
    clock: new FakeClock(),
    watcher: { tickEveryMs: 1000, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 },
  });
}

// A real-length authored biography (a producer's actual backstory — multi-sentence).
const AUTHORED_BIO =
  "Outside the house they run a beloved neighborhood bakery they built from a single market stall over a "
  + "decade of dawn shifts. They learned to read a room from years behind the counter, and they are quietly "
  + "certain that charm is just attention paid on purpose. They came to play a sharp, social game.";

describe("#1067 — season-start authoring lands without a degradation refusal", () => {
  it("the LIVE authoring write-back commits and PERSISTS the authored biography", () => {
    const dir = freshDir();
    const runtime = liveRuntime(dir);
    const sb = runtime.registry.sandboxFor("u");
    sb.session.createCharacter({ playerName: "Player One", seed: 7 }); // seeds the floor + the baseline

    const npcId = sb.session.snapshot().house!.npcs[0]!.id;
    const floorBio = sb.session.snapshot().house!.npcs[0]!.character.biography;
    expect(floorBio).toBeTruthy();

    const res = sb.session.recordCastProfile({ houseguestId: npcId, biography: AUTHORED_BIO });
    expect(res.accepted).toBe(true);

    // The authored biography is DURABLY persisted by the write-back itself (it routes through the
    // background-persist seam, like the 0062 zeitgeist) — no later turn is needed to flush it.
    const saved = new FileSaveStore(dir).loadLatest("u")!;
    const savedNpc = saved.house!.npcs.find((n) => n.id === npcId)!;
    expect(savedNpc.character.biography).toBe(AUTHORED_BIO);
    expect(savedNpc.character.biography).not.toBe(floorBio);
  });

  it("a subsequent genuine player-turn commit is NOT refused after authoring", () => {
    const runtime = liveRuntime();
    const sb = runtime.registry.sandboxFor("u");
    sb.session.createCharacter({ playerName: "Player One", seed: 7 });
    const npcId = sb.session.snapshot().house!.npcs[0]!.id;

    sb.session.recordCastProfile({ houseguestId: npcId, biography: AUTHORED_BIO });
    // The orchestrator's next player-turn commit compares the (now-authored) candidate against its
    // floor baseline; before the fix this threw `TurnRefusedError ... (degradation)`.
    runtime.registry.invalidateSnapshot("u");
    expect(() => runtime.orchestrator.commitPlayerTurn("u")).not.toThrow();
  });

  it("authoring every houseguest in a burst leaves ZERO integrity faults (the 15-NPC live case)", () => {
    const runtime = liveRuntime();
    const sb = runtime.registry.sandboxFor("u");
    sb.session.createCharacter({ playerName: "Player One", seed: 11 });
    const npcs = sb.session.snapshot().house!.npcs.map((n) => n.id);
    expect(npcs.length).toBeGreaterThanOrEqual(15);

    for (const id of npcs) {
      const res = sb.session.recordCastProfile({
        houseguestId: id,
        biography: AUTHORED_BIO,
        secrets: ["carries a quiet debt no one knows about"],
        trueGoals: ["reach the end without a target on their back"],
        weakness: "loyal to a fault, slow to cut a friend",
      });
      expect(res.accepted).toBe(true);
    }
    // Drive a real player-turn commit through the orchestrator — it must not refuse.
    runtime.registry.invalidateSnapshot("u");
    expect(() => runtime.orchestrator.commitPlayerTurn("u")).not.toThrow();
    const health = runtime.orchestrator.sandboxHealth("u") as { lastIntegrity: string };
    expect(health.lastIntegrity).toBe("ok");
  });

  it("the authoring write-back does NOT drop the co-kind private-orientation Vault record", () => {
    const runtime = liveRuntime();
    const sb = runtime.registry.sandboxFor("u");
    sb.session.createCharacter({ playerName: "Player One", seed: 7 });
    const npcId = sb.session.snapshot().house!.npcs[0]!.id;

    const before = sb.engine.vault.readHidden().filter((r) => r.subject === npcId).map((r) => r.id).sort();
    sb.session.recordCastProfile({ houseguestId: npcId, biography: AUTHORED_BIO });
    const after = sb.engine.vault.readHidden().filter((r) => r.subject === npcId).map((r) => r.id).sort();

    // Every id present before the re-seal is still present after (the deep-profile record is upserted in
    // place; the co-kind `private-orientation:<id>` is untouched).
    for (const id of before) expect(after).toContain(id);
  });
});

/**
 * The guard is NOT weakened — the sanctioned upgrade is the ONLY exception, and it is one-directional.
 * These are pure-`GameState` checks of `isSuperset` so the degradation cases are unambiguous.
 */
describe("#1067 — non-degradation is preserved (the guard still refuses genuine degradation)", () => {
  const mk = (over: Partial<PersistedCharacter>): GameState => ({
    coreVersion: 1, vaultVersion: 1, journalVersion: 1, events: [], knowledge: [], relationships: [], souls: {},
    characters: {
      "npc:1": {
        archetype: "a", strategyStyle: "s", stats: { physical: 1, mental: 1, social: 1 }, background: "bg",
        ...over,
      } as PersistedCharacter,
    },
  });

  it("ACCEPTS the one-time floor→authored public-facet upgrade", () => {
    const floor = mk({ biography: "floor placeholder bio" });
    const authored = mk({ biography: AUTHORED_BIO, deepProfileAuthored: true });
    expect(isSuperset(authored, floor)).toBe(true);
    // …and on the R3 fast path too (the orchestrator's per-turn trustEventPrefix mode).
    expect(isSuperset(authored, floor, { trustEventPrefix: true })).toBe(true);
  });

  it("REFUSES thinning an already-authored biography (true→true is byte-stable)", () => {
    const authored = mk({ biography: AUTHORED_BIO, deepProfileAuthored: true });
    const thinned = mk({ biography: "thin", deepProfileAuthored: true });
    expect(isSuperset(thinned, authored)).toBe(false);
  });

  it("REFUSES reverting an authored profile back to the floor (true→unset)", () => {
    const authored = mk({ biography: AUTHORED_BIO, deepProfileAuthored: true });
    const reverted = mk({ biography: "floor placeholder bio" }); // flag dropped
    expect(isSuperset(reverted, authored)).toBe(false);
  });

  it("REFUSES smuggling a byte-stable identity change into the upgrade", () => {
    const floor = mk({ biography: "floor placeholder bio" });
    const sneaky = mk({ biography: AUTHORED_BIO, deepProfileAuthored: true, background: "CHANGED" });
    expect(isSuperset(sneaky, floor)).toBe(false);
  });

  it("REFUSES dropping a public facet the floor had on the upgrade", () => {
    const floor = mk({ biography: "floor bio", vocation: "baker" });
    const dropped = mk({ biography: AUTHORED_BIO, deepProfileAuthored: true }); // vocation gone
    expect(isSuperset(dropped, floor)).toBe(false);
  });
});
