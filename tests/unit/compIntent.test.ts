import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { newLiveSeason, advance, applyDecision, type SeasonCtx } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature B46 / audit B5 — live competition intent. The player declares compete / throw / play-safe
 * before a comp they play; the engine threads it into the resolution (the 0028 penalties), immutable
 * once the result is given. HARD rule: roles only — no names.
 */

/** Does the player win the OPENING HOH competition with the given declared intent (deterministic per seed)? */
function playerWinsOpeningHoh(seed: number, intent: "compete" | "throw" | "play-safe"): boolean {
  const s = new GameSessionAdapter();
  s.createCharacter({ playerName: "P", seed });
  const intentPending = s.advanceGame();           // the loop pauses for the player's intent
  expect(intentPending.pending?.kind).toBe("comp-intent");
  const adv = s.submitDecision({ kind: "comp-intent", intent }); // the HOH comp resolves with it
  return adv.status.hoh?.id === PLAYER;
}

describe("B46 — a declared throw measurably lowers the player's win rate", () => {
  it("throwing the opening HOH wins far less often than competing, across seeds", () => {
    let competeWins = 0, throwWins = 0;
    for (let seed = 1; seed <= 150; seed++) {
      if (playerWinsOpeningHoh(seed, "compete")) competeWins++;
      if (playerWinsOpeningHoh(seed, "throw")) throwWins++;
    }
    expect(competeWins).toBeGreaterThan(0);          // the player CAN win when they try
    expect(throwWins).toBeLessThan(competeWins);     // throwing measurably lowers the win rate (0028 penalty)
  });

  it("the comp-intent decision offers compete / throw / play-safe (compete first = the default)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 2 });
    const view = s.advanceGame();
    expect(view.pending?.kind).toBe("comp-intent");
    expect(view.pending!.options.map((o) => o.id)).toEqual(["compete", "throw", "play-safe"]);
  });
});

describe("B46 — intent is immutable once the result is given (the lock)", () => {
  it("declaring intent AFTER the competition resolves is refused", () => {
    const ctx: SeasonCtx = { player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel: new RelationshipModel(0.5) };
    const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4)]);
    const rng = new SeededRandom(3);

    advance(s, ctx, rng); // pauses for comp-intent (the player plays the opening HOH)
    expect(s.pending?.kind).toBe("comp-intent");
    applyDecision(s, { kind: "comp-intent", intent: "throw" }, ctx, rng); // resolves the HOH comp
    expect(s.pending).toBeUndefined();

    // The beat has moved on (nominations) — there is no comp-intent pending, so a late declaration is refused.
    expect(() => applyDecision(s, { kind: "comp-intent", intent: "compete" }, ctx, rng)).toThrow();
  });

  it("a late comp-intent through the live adapter is a no-op (the crowned HOH stands)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 2 });
    s.advanceGame();
    const crowned = s.submitDecision({ kind: "comp-intent", intent: "compete" }).status.hoh!.id;
    // No comp-intent is pending now; submitting one again changes nothing (immutability).
    const after = s.submitDecision({ kind: "comp-intent", intent: "throw" });
    expect(after.status.hoh!.id).toBe(crowned);
  });
});
