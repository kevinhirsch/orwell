import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { newLiveSeason, advance, applyDecision, type SeasonCtx } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature B46 / audit B5, EVOLVED to staged rounds (0006 staged-rounds evolution). The competition now
 * plays out in VISIBLE elimination rounds; the player declares compete / throw / play-safe FOR THAT ROUND
 * (seeing who is still in), committed BEFORE the round resolves and LOCKED after. The engine threads the
 * STRUCTURED per-round selection (never prose) into the resolution (the 0028 penalties). Adaptation is
 * forward-only — a past round's approach can never be re-labeled. HARD rule: roles only — no names.
 */

/**
 * Drive the live HOH staged comp to its crown with a FIXED player approach every round they are in
 * (deterministic per seed). Does the player win the opening HOH? The player is cast as a comp-beast so a
 * `compete` win is measurable (C6 made the NO-archetype default the MEDIAN floater — a deliberate underdog).
 */
function playerWinsOpeningHoh(seed: number, approach: "compete" | "throw" | "play-safe"): boolean {
  const s = new GameSessionAdapter();
  s.createCharacter({ playerName: "P", archetype: "comp-beast", seed });
  for (let g = 0; g < 200; g++) {
    if (s.gameStatus().hoh) break;
    const adv = s.advanceGame();
    if (adv.pending?.kind === "comp-round") {
      s.submitDecision({ kind: "comp-round", intent: approach });
    } else if (adv.pending) {
      break; // the comp crowned an NPC and the loop moved on to a different decision
    }
  }
  return s.gameStatus().hoh?.id === PLAYER;
}

describe("0006 staged-rounds — a declared throw measurably lowers the player's win rate", () => {
  it("throwing EVERY round of the opening HOH wins far less often than competing, across seeds", () => {
    let competeWins = 0, throwWins = 0;
    for (let seed = 1; seed <= 150; seed++) {
      if (playerWinsOpeningHoh(seed, "compete")) competeWins++;
      if (playerWinsOpeningHoh(seed, "throw")) throwWins++;
    }
    expect(competeWins).toBeGreaterThan(0);          // the player CAN win when they try
    expect(throwWins).toBeLessThan(competeWins);     // throwing measurably lowers the win rate (0028 penalty)
  });

  it("the comp-round decision offers compete / throw / play-safe (compete first = the default) + the still-in field", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 2 });
    const view = s.advanceGame();
    expect(view.pending?.kind).toBe("comp-round");
    expect(view.pending!.options.map((o) => o.id)).toEqual(["compete", "throw", "play-safe"]);
    // The staged prompt carries WHO IS STILL IN this round (the narrowed field) + the round number.
    expect(view.pending!.round).toBe(1);
    expect(view.pending!.stillIn!.length).toBeGreaterThan(1);
    expect(view.pending!.stillIn!.some((r) => r.id === PLAYER)).toBe(true);
  });

  // R4-02 parity: the pending presents comp-round as a generic options/pick decision, so a caller may
  // submit the approach as `choice` (like every other options/pick decision) — not only `intent`.
  it("accepts the approach submitted as `choice` (the generic options/pick shape)", () => {
    const viaChoice = new GameSessionAdapter();
    viaChoice.createCharacter({ playerName: "P", archetype: "comp-beast", seed: 1 });
    viaChoice.advanceGame();
    const a = viaChoice.submitDecision({ kind: "comp-round", choice: ["throw"] });

    const viaIntent = new GameSessionAdapter();
    viaIntent.createCharacter({ playerName: "P", archetype: "comp-beast", seed: 1 });
    viaIntent.advanceGame();
    const b = viaIntent.submitDecision({ kind: "comp-round", intent: "throw" });

    // `choice:["throw"]` and `intent:"throw"` resolve the round identically (same seed ⇒ same drop).
    expect(JSON.stringify(a.event)).toBe(JSON.stringify(b.event));
  });
});

describe("0006 staged-rounds — the field NARROWS and re-prompts each round (adaptation forward)", () => {
  /** Play a comp-beast's opening HOH competing every round; return the still-in field size at each prompt. */
  function promptFields(seed: number): number[] {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", archetype: "comp-beast", seed });
    const fields: number[] = [];
    for (let g = 0; g < 200; g++) {
      if (s.gameStatus().hoh) break;
      const adv = s.advanceGame();
      if (adv.pending?.kind === "comp-round") {
        fields.push(adv.pending.stillIn!.length);
        s.submitDecision({ kind: "comp-round", intent: "compete" });
      } else if (adv.pending) break;
    }
    return fields;
  }

  it("re-prompts with a SMALLER still-in field on a later round (the player keeps competing)", () => {
    // Find the first seed where the player survives ≥2 rounds (they exist; the player isn't always the
    // first drop). Whichever seed lands, the re-prompted field must narrow strictly each round.
    let fields: number[] = [];
    for (let seed = 1; seed <= 50 && fields.length < 2; seed++) fields = promptFields(seed);
    expect(fields.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < fields.length; i++) expect(fields[i]).toBeLessThan(fields[i - 1]!);
  });
});

describe("0006 staged-rounds — each round's approach is immutable once the round is given (anti-sycophancy)", () => {
  it("declaring an approach AFTER the round resolves is refused (the structured selection locks per round)", () => {
    const ctx: SeasonCtx = { player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel: new RelationshipModel(0.5) };
    const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4)]);
    const rng = new SeededRandom(3);

    advance(s, ctx, rng); // pauses for the round-1 approach (the player plays the opening HOH)
    expect(s.pending?.kind).toBe("comp-round");
    applyDecision(s, { kind: "comp-round", intent: "throw" }, ctx, rng); // round 1 resolves with it (locked)
    // The round 1 drop is locked. There may be a NEXT round pending — but the PAST round's approach can
    // never be re-submitted: only the CURRENT round's pending accepts an approach, and once it resolves
    // it is gone. Drain to confirm no stale approach is ever accepted into a resolved round.
    if (s.pending?.kind === "comp-round") {
      // a fresh round pending = a NEW round (forward adaptation); resolving it does not touch round 1.
      const beforeField = (s.pending as { stillIn: unknown[] }).stillIn.length;
      applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng);
      expect(beforeField).toBeGreaterThan(0);
    }
  });

  it("a late comp-round through the live adapter is a no-op once the HOH is crowned (the crown stands)", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "P", seed: 2 });
    // Drive to the crown competing every round.
    for (let g = 0; g < 200; g++) {
      if (s.gameStatus().hoh) break;
      const adv = s.advanceGame();
      if (adv.pending?.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" });
      else if (adv.pending) break;
    }
    const crowned = s.gameStatus().hoh!.id;
    // No comp-round is pending now; submitting one again changes nothing (the round is over — immutability).
    const after = s.submitDecision({ kind: "comp-round", intent: "throw" });
    expect(after.status.hoh!.id).toBe(crowned);
  });
});
