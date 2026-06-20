import { describe, it, expect } from "vitest";
import { vetoParticipants, type WeekState } from "../../src/domain/eligibility";
import { newLiveSeason, advance, applyDecision, type SeasonCtx, type LiveSeasonState } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { cloneSession } from "../../src/engine/sessionSnapshot";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * Feature B45 / audit B4 — "Houseguest's Choice" pauses for the player. When the PLAYER draws the
 * chip the engine must NOT pick the sixth veto player from their hidden bonds (canon agency removed,
 * the "never assert how the player feels" rule inverted into action). HARD rule: roles only — no names.
 */
const ctxOf = (rel: RelationshipModel): SeasonCtx => ({ player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel });
const sixHouse = [PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)];

describe("B45 — the player drawing the chip defers the pick (eligibility)", () => {
  it("when the player (a puller) draws Houseguest's Choice, the engine DOES NOT pick — it defers", () => {
    const week: WeekState = { houseguests: sixHouse, player: PLAYER, hoh: PLAYER, nominees: [npc(1), npc(2)] };
    // Find a seed where the player (the HOH, first puller) draws the chip.
    let drew = false;
    for (let seed = 1; seed <= 300 && !drew; seed++) {
      const chosenFor: string[] = [];
      const draw = vetoParticipants(week, new SeededRandom(seed), {
        houseguestsChoiceChip: true,
        choose: (h, cands) => { chosenFor.push(h); return cands[0]!; },
        playerChoosesOwn: PLAYER,
      });
      if (draw.houseguestsChoice?.holder === PLAYER) {
        drew = true;
        expect(draw.houseguestsChoice.picked).toBeUndefined();         // deferred — no engine pick
        expect(chosenFor).not.toContain(PLAYER);                       // the engine never chose for the player
        expect(draw.houseguestsChoice.candidates.length).toBeGreaterThan(0);
        expect(draw.participants).toHaveLength(5);                      // a player short, completed on the pick
      }
    }
    expect(drew, "found a seed where the player draws the chip").toBe(true);
  });

  it("an NPC drawing the chip still auto-picks (existing behavior preserved)", () => {
    const week: WeekState = { houseguests: sixHouse, player: PLAYER, hoh: npc(1), nominees: [npc(2), npc(3)] };
    let drew = false;
    for (let seed = 1; seed <= 300 && !drew; seed++) {
      const draw = vetoParticipants(week, new SeededRandom(seed), {
        houseguestsChoiceChip: true,
        choose: (_h, cands) => cands[0]!,
        playerChoosesOwn: PLAYER,
      });
      if (draw.houseguestsChoice && draw.houseguestsChoice.holder !== PLAYER) {
        drew = true;
        expect(draw.houseguestsChoice.picked).toBeDefined();           // the NPC's pick is made during the draw
        expect(draw.participants).toHaveLength(6);
      }
    }
    expect(drew).toBe(true);
  });
});

describe("B45 — the live loop pauses for the player's Houseguest's Choice", () => {
  /** Build a veto-competition state, then find a seed (its beat rng) where the player draws the chip. */
  function pausedState(): { s: LiveSeasonState; ctx: SeasonCtx; rng: SeededRandom } {
    const ctx = ctxOf(new RelationshipModel(0.5));
    for (let seed = 1; seed <= 400; seed++) {
      const s = newLiveSeason(sixHouse);
      s.beat = "veto-competition"; s.hoh = PLAYER; s.nominees = [npc(1), npc(2)];
      const rng = new SeededRandom(seed);
      // E35: the chip draw is the FIRST stage — a witnessed beat that may pause for the player's pick.
      const draw = advance(s, ctx, rng);
      if (s.pending?.kind === "houseguests-choice") {
        expect(draw?.beat).toBe("veto-draw"); // the draw was witnessed even though the pick is pending
        return { s, ctx, rng: new SeededRandom(seed) };
      }
    }
    throw new Error("no seed produced a player Houseguest's Choice draw");
  }

  /** Resolve the post-pick stages: declare a per-round approach each round (the player is a puller),
   *  then the STAGED comp runs to its crown (0006 staged-rounds). */
  function finishVeto(s: LiveSeasonState, ctx: SeasonCtx, rng: SeededRandom): void {
    for (let g = 0; g < 50 && !s.vetoHolder; g++) {
      if (s.pending?.kind === "comp-round") applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng);
      else if (!s.pending && s.beat === "veto-competition") advance(s, ctx, rng);
      else break;
    }
  }

  it("pauses on a houseguests-choice decision; refuses an illegal pick; a legal pick completes the field", () => {
    const { s, ctx } = pausedState();
    const options = (s.pending as { options: string[] }).options;
    expect(options.length).toBeGreaterThan(0);
    // C1: every offered candidate is re-derivable as legal — none already stands in the drawn field.
    for (const o of options) expect(s.vetoField).not.toContain(o);

    expect(() => applyDecision(s, { kind: "houseguests-choice", pick: npc(99) }, ctx)).toThrow(); // not a candidate
    const ev = applyDecision(s, { kind: "houseguests-choice", pick: options[0]! }, ctx, new SeededRandom(1));
    expect(ev.beat).toBe("veto-draw");          // the completed field is the witnessed beat (E35)
    expect(s.vetoField).toContain(options[0]); // the player's pick is in the field
    expect(s.vetoField).toHaveLength(6);
    expect(new Set(s.vetoField).size).toBe(6);  // C1: six DISTINCT competitors — never a duplicate
    // E35 + 0006 staged-rounds: the completed field is the witnessed beat; the STAGED comp begins on
    // the next advance, pausing for the player's per-round approach (the player is a puller).
    expect(s.pending).toBeUndefined();
    advance(s, ctx, new SeededRandom(1));
    expect(s.pending?.kind).toBe("comp-round");
    finishVeto(s, ctx, new SeededRandom(1));
    expect(s.vetoHolder).toBeTruthy();          // the veto winner resolved over the completed field
    expect(s.beat).toBe("veto-ceremony");
    expect(s.pending).toBeUndefined();
  });

  it("the player's Houseguest's Choice decision survives a restart", () => {
    const { s, ctx } = pausedState();
    const restored = cloneSession<LiveSeasonState>(s); // a durable round-trip (0030)
    expect(restored.pending?.kind).toBe("houseguests-choice");
    const options = (restored.pending as { options: string[] }).options;
    const ev = applyDecision(restored, { kind: "houseguests-choice", pick: options[0]! }, ctx, new SeededRandom(1));
    expect(ev.beat).toBe("veto-draw");
    expect(restored.vetoField).toHaveLength(6);
    finishVeto(restored, ctx, new SeededRandom(1));
    expect(restored.beat).toBe("veto-ceremony");
  });

  it("C1: a stale candidate (drawn after the chip) can never produce a duplicate competitor", () => {
    const { s, ctx } = pausedState();
    // Every member of the already-drawn field is refused as a pick — re-derived legality at resume.
    for (const member of s.vetoField!) {
      expect(() => applyDecision(s, { kind: "houseguests-choice", pick: member }, ctx)).toThrow();
      expect(s.pending?.kind).toBe("houseguests-choice"); // the decision stands after each refusal
    }
  });
});

// --- C1 (execution-confirmed audit bug): the deferred candidate list is never stale ----------

describe("C1 — Houseguest's Choice deferral over seeds × house sizes (property)", () => {
  it("the deferred candidates exclude every drawn participant; the resumed field is always legal", () => {
    const ctx = ctxOf(new RelationshipModel(0.5));
    let deferrals = 0;
    for (let size = 5; size <= 16; size++) {
      const house = [PLAYER, ...Array.from({ length: size - 1 }, (_, i) => npc(i + 1))];
      for (let seed = 1; seed <= 120; seed++) {
        // The player rotates through every puller seat (HOH / nominee) so each chip position defers.
        for (const [hoh, n1, n2] of [
          [PLAYER, npc(1), npc(2)], [npc(1), PLAYER, npc(2)], [npc(1), npc(2), PLAYER],
        ] as const) {
          const s = newLiveSeason(house);
          s.beat = "veto-competition"; s.hoh = hoh; s.nominees = [n1, n2];
          const rng = new SeededRandom(seed * 31 + size);
          advance(s, ctx, rng);
          if (s.pending?.kind !== "houseguests-choice") continue;
          deferrals++;
          const options = (s.pending as { options: string[] }).options;
          // The candidate list is snapshotted AFTER the full draw: no offered candidate is drawn.
          for (const o of options) expect(s.vetoField, `seed ${seed} size ${size}`).not.toContain(o);
          // Resuming with the first candidate yields a duplicate-free field of the legal size.
          applyDecision(s, { kind: "houseguests-choice", pick: options[0]! }, ctx, new SeededRandom(seed));
          const field = s.vetoField!;
          expect(new Set(field).size).toBe(field.length);
          expect(field.length).toBe(Math.min(6, size));
        }
      }
    }
    expect(deferrals).toBeGreaterThan(50); // the property genuinely exercised the deferral path
  });
});
