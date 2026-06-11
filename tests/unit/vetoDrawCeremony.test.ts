import { describe, it, expect } from "vitest";
import {
  newLiveSeason, advance, applyDecision, peekCompetition,
  type SeasonCtx, type LiveSeasonState, type BeatEvent,
} from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * E35 — the veto draw is a witnessed ceremony and a chip-drawn player declares intent —
 * and E36 — the Final-4 veto decision is honest about its legal set. HARD rule: roles only.
 */
const ctxOf = (rel: RelationshipModel): SeasonCtx => ({
  player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel,
});

describe("E35 — the veto chip draw is a witnessed beat preceding any winner", () => {
  it("emits a veto-draw beat naming the field (and any Houseguest's Choice holder + pick) before the comp", () => {
    const ctx = ctxOf(new RelationshipModel(0.5));
    let sawHcInContent = false;
    for (let seed = 1; seed <= 60; seed++) {
      const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5), npc(6), npc(7)]);
      // The player is NOT a puller here: any intent pause must come from being chip-drawn.
      s.beat = "veto-competition"; s.hoh = npc(1); s.nominees = [npc(2), npc(3)];
      const rng = new SeededRandom(seed);
      const draw = advance(s, ctx, rng);
      // Stage A: the draw beat is witnessed FIRST — no winner exists yet.
      expect(draw?.beat).toBe("veto-draw");
      expect(s.vetoHolder).toBeUndefined();
      expect(s.vetoField).toBeDefined();
      for (const id of s.vetoField!) expect(draw!.participants).toContain(id);
      if (/Houseguest's Choice/.test(draw!.content)) sawHcInContent = true;
      // Stage B: the comp resolves on a later advance (after any player intent declaration).
      let comp: BeatEvent | null = null;
      for (let g = 0; g < 5 && !comp; g++) {
        if (s.pending?.kind === "comp-intent") { comp = applyDecision(s, { kind: "comp-intent", intent: "compete" }, ctx, rng); break; }
        comp = advance(s, ctx, rng);
      }
      expect(comp?.beat).toBe("veto-competition");
      expect(s.vetoHolder).toBeDefined();
      expect(s.vetoField).toContain(s.vetoHolder);
    }
    // Across the seed sweep, the Houseguest's Choice holder + pick surfaced in the witnessed draw.
    expect(sawHcInContent).toBe(true);
  });

  it("a player drawn into the field BY CHIP declares the canonical compete/throw/play-safe intent", () => {
    const ctx = ctxOf(new RelationshipModel(0.5));
    let chipDrawnIntents = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)]);
      s.beat = "veto-competition"; s.hoh = npc(1); s.nominees = [npc(2), npc(3)]; // the player is no puller
      const rng = new SeededRandom(seed);
      advance(s, ctx, rng); // the witnessed draw
      if (!s.vetoField!.includes(PLAYER)) {
        // Not drawn: the comp resolves with NO player intent pause.
        const comp = advance(s, ctx, rng);
        expect(s.pending).toBeUndefined();
        expect(comp?.beat).toBe("veto-competition");
        continue;
      }
      // Chip-drawn: the loop pauses for the player's declaration before the comp runs (E35).
      expect(advance(s, ctx, rng)).toBeNull();
      expect(s.pending?.kind).toBe("comp-intent");
      chipDrawnIntents++;
      const comp = applyDecision(s, { kind: "comp-intent", intent: "throw" }, ctx, rng);
      expect(comp.beat).toBe("veto-competition");
      expect(s.compIntent).toBeUndefined(); // consumed by the resolution (immutability holds)
    }
    expect(chipDrawnIntents).toBeGreaterThan(0); // the chip-drawn path was genuinely exercised
  });

  it("the preview agrees with the staged resolution: null before the draw, the same winner after it", () => {
    const ctx = ctxOf(new RelationshipModel(0.5));
    for (let seed = 1; seed <= 20; seed++) {
      const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5), npc(6)]);
      s.beat = "veto-competition"; s.hoh = npc(1); s.nominees = [npc(2), npc(3)];
      // Before the chips come out there is no field — nothing to preview (E35).
      expect(peekCompetition(s, ctx, new SeededRandom(seed))).toBeNull();
      advance(s, ctx, new SeededRandom(seed)); // the draw
      const pendingKind = (): string | undefined => s.pending?.kind; // defeats narrowing across mutations
      if (pendingKind() !== undefined) continue; // a player pause — previews stay null while pending
      const peek = peekCompetition(s, ctx, new SeededRandom(seed));
      expect(peek).not.toBeNull();
      // The loop crowns the SAME winner the preview reported (single authority, B37).
      let comp: BeatEvent | null = null;
      for (let g = 0; g < 5 && !comp; g++) {
        if (pendingKind() === "comp-intent") { comp = applyDecision(s, { kind: "comp-intent", intent: "compete" }, ctx, new SeededRandom(seed)); break; }
        comp = advance(s, ctx, new SeededRandom(seed));
      }
      expect(s.vetoHolder).toBe(peek!.winner);
    }
  });
});

describe("E36 — the Final-4 veto decision is honest about its legal set", () => {
  /** Final 4 with the PLAYER holding the veto as the un-nominated non-HOH: no legal replacement exists. */
  function f4State(): { s: LiveSeasonState; ctx: SeasonCtx } {
    const ctx = ctxOf(new RelationshipModel(0.5));
    const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3)]);
    s.beat = "veto-ceremony"; s.hoh = npc(1); s.nominees = [npc(2), npc(3)];
    s.vetoField = [PLAYER, npc(1), npc(2), npc(3)]; s.vetoHolder = PLAYER;
    return { s, ctx };
  }

  it("offers an EMPTY saveable set when no legal replacement exists — never 'use' that silently inverts", () => {
    const { s, ctx } = f4State();
    expect(advance(s, ctx, new SeededRandom(1))).toBeNull();
    expect(s.pending?.kind).toBe("veto-decision");
    expect((s.pending as { saveable: EntityId[] }).saveable).toEqual([]);
  });

  it("refuses {use:true} with the decision STANDING; {use:false} resolves the ceremony as submitted", () => {
    const { s, ctx } = f4State();
    advance(s, ctx, new SeededRandom(1));
    // Submitting "use" is refused outright — the engine never accepts a choice it must invert (E36).
    expect(() => applyDecision(s, { kind: "veto-decision", use: true, save: npc(2) }, ctx)).toThrow(/replacement/);
    expect(s.pending?.kind).toBe("veto-decision"); // the decision stands after the refusal
    // The submitted "don't use" resolves exactly as submitted.
    const ev = applyDecision(s, { kind: "veto-decision", use: false }, ctx);
    expect(ev.beat).toBe("veto-ceremony");
    expect(s.vetoUsed).toBe(false);
    expect(s.finalNominees).toEqual([npc(2), npc(3)]);
    expect(s.beat).toBe("eviction");
  });

  it("a nominated player-holder at Final 4 can still legally save (the fourth houseguest goes up)", () => {
    const ctx = ctxOf(new RelationshipModel(0.5));
    const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3)]);
    s.beat = "veto-ceremony"; s.hoh = npc(1); s.nominees = [PLAYER, npc(2)];
    s.vetoField = [PLAYER, npc(1), npc(2), npc(3)]; s.vetoHolder = PLAYER;
    advance(s, ctx, new SeededRandom(1));
    // A replacement (the un-nominated fourth) exists, so the full pair is saveable.
    expect((s.pending as { saveable: EntityId[] }).saveable).toEqual([PLAYER, npc(2)]);
    applyDecision(s, { kind: "veto-decision", use: true, save: PLAYER }, ctx);
    expect(s.vetoUsed).toBe(true);
    expect(s.finalNominees).toEqual([npc(2), npc(3)]); // the fourth houseguest went up
  });
});
