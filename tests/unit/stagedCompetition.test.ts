import { describe, it, expect } from "vitest";
import { resolveCompetition, eliminationOrder, CompetitionIntents, type Competitor } from "../../src/domain/competitionOutcome";
import { newLiveSeason, advance, applyDecision, peekCompetition, type SeasonCtx } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { Stats } from "../../src/engine/season";

/**
 * 0006 staged-rounds evolution — the endurance-style elimination model (PR #395). The competition plays
 * out in VISIBLE rounds until one remains. FULL-TRAJECTORY OUTCOME-NEUTRALITY (the anti-sycophancy
 * backstop, mandate #3, + the jury calibration band): the staged rounds are a PRESENTATION re-telling of
 * the single-shot 0006 outcome — the CROWN is the byte-identical `resolveCompetition` winner, and the
 * drop ORDER is derived PURELY from that roll's scores (`eliminationOrder`, ZERO extra randomness), so the
 * staging can never perturb the winner OR any downstream roll. The end-to-end byte-identity of the whole
 * game trajectory is proven in `stagedTrajectoryNeutral.test.ts`; here we pin the local pieces: the
 * `eliminationOrder` derivation, the unchanged 0006 calibration band, and the per-round agency surface.
 * HARD rule: roles only — no names.
 */

const flat = (v: number): Stats => ({ physical: v, mental: v, social: v });

describe("0006 staged-rounds — eliminationOrder is a pure, zero-rng re-telling of the single roll", () => {
  const buildField = (n: number, favorite = 0.8): Competitor[] => [
    { id: PLAYER, stats: flat(favorite) },
    ...Array.from({ length: n - 1 }, (_, i) => ({ id: npc(i + 1), stats: flat(0.5) })),
  ];

  it("derives the drop order from the SAME roll's scores — lowest drops first, ascending to the winner", () => {
    for (const n of [3, 6, 16]) {
      const field = buildField(n);
      const ids = field.map((c) => c.id);
      for (let seed = 1; seed <= 200; seed++) {
        const result = resolveCompetition(field, "endurance", new CompetitionIntents(), new SeededRandom(seed));
        const order = eliminationOrder(ids, result);
        // The crown survives every round by construction; every loser drops exactly once.
        expect(order).not.toContain(result.winner);
        expect(order.length, `n=${n}`).toBe(n - 1);
        expect(new Set(order).size).toBe(n - 1);
        // The order is strictly non-decreasing by score (lowest first), the winner's score the highest.
        for (let i = 1; i < order.length; i++) {
          expect(result.scores[order[i]!]!).toBeGreaterThanOrEqual(result.scores[order[i - 1]!]!);
        }
        for (const loser of order) expect(result.scores[result.winner]!).toBeGreaterThanOrEqual(result.scores[loser]!);
      }
    }
  });

  it("consumes NO randomness — it reads ONLY the already-computed result (pure derivation)", () => {
    const field = buildField(8);
    const ids = field.map((c) => c.id);
    const result = resolveCompetition(field, "endurance", new CompetitionIntents(), new SeededRandom(99));
    // Two derivations from the SAME result are byte-identical (no hidden rng state involved).
    expect(eliminationOrder(ids, result)).toEqual(eliminationOrder(ids, result));
  });
});

describe("0006 staged-rounds — the favorite-win calibration HOLDS (the crown is the single roll)", () => {
  // The staged CROWN is byte-identical to the single-roll `resolveCompetition` winner, so the favorite-win
  // band is the SAME 0006 band — the staging narrates the calibrated outcome, it does not inflate it.
  const stagedWinner = (field: Competitor[], seed: number): EntityId =>
    resolveCompetition(field, "endurance", new CompetitionIntents(), new SeededRandom(seed)).winner;

  it("a clear stat favorite wins a STRONG MAJORITY across field sizes (the 0006 65–80% band)", () => {
    const buildField = (n: number): Competitor[] => [
      { id: PLAYER, stats: flat(0.9) },
      ...Array.from({ length: n - 1 }, (_, i) => ({ id: npc(i + 1), stats: flat(0.5) })),
    ];
    for (const n of [6, 12, 16]) {
      const field = buildField(n);
      let favWins = 0;
      const RUNS = 1500;
      for (let seed = 1; seed <= RUNS; seed++) if (stagedWinner(field, seed) === PLAYER) favWins++;
      const rate = favWins / RUNS;
      expect(rate, `n=${n}: favorite win rate ${rate.toFixed(3)}`).toBeGreaterThan(0.6);
      expect(rate, `n=${n}: favorite win rate ${rate.toFixed(3)}`).toBeLessThan(0.85);
    }
  });

  it("the favorite still loses a REAL minority (temperature breaks predictability — no Luck stat)", () => {
    const field: Competitor[] = [
      { id: PLAYER, stats: flat(0.8) },
      ...Array.from({ length: 11 }, (_, i) => ({ id: npc(i + 1), stats: flat(0.5) })),
    ];
    let upsets = 0;
    for (let seed = 1; seed <= 1000; seed++) if (stagedWinner(field, seed) !== PLAYER) upsets++;
    expect(upsets).toBeGreaterThan(0);
  });

  it("equal-stat houseguests each win ~their fair share (no hidden favor; symmetry preserved)", () => {
    const field: Competitor[] = Array.from({ length: 8 }, (_, i) => ({ id: npc(i + 1), stats: flat(0.5) }));
    const wins = new Map<EntityId, number>(field.map((c) => [c.id, 0]));
    const RUNS = 2000;
    for (let seed = 1; seed <= RUNS; seed++) {
      const w = stagedWinner(field, seed);
      wins.set(w, (wins.get(w) ?? 0) + 1);
    }
    const fair = RUNS / field.length;
    for (const c of field) {
      const w = wins.get(c.id)!;
      expect(w, `id ${c.id} won ${w} of ${RUNS} (fair ≈ ${fair})`).toBeGreaterThan(fair * 0.6);
      expect(w).toBeLessThan(fair * 1.5);
    }
  });
});

describe("0006 staged-rounds — per-round approach is committed before, locked after (anti-sycophancy)", () => {
  const ctxOf = (rel: RelationshipModel): SeasonCtx => ({ player: PLAYER, statsOf: () => flat(0.5), rel });

  it("the LIVE staged loop crowns the SAME houseguest the preview reported when the player competes", () => {
    const ctx = ctxOf(new RelationshipModel(0.5));
    for (let seed = 1; seed <= 25; seed++) {
      const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)]);
      const peek = peekCompetition(s, ctx, new SeededRandom(seed));
      expect(peek).not.toBeNull(); // the HOH comp opens the season; a preview exists
      // Drive the staged comp competing every round (the preview's default). The production seam re-mints a
      // FRESH per-beat rng on every advance/decision — mirror that with a fresh SeededRandom(seed) per call.
      const beatRng = (): SeededRandom => new SeededRandom(seed);
      for (let g = 0; g < 30 && !s.hoh; g++) {
        if (s.pending?.kind === "comp-round" || s.pending?.kind === "comp-intent") {
          applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, beatRng());
        } else {
          advance(s, ctx, beatRng());
        }
      }
      expect(s.hoh).toBe(peek!.winner); // single outcome authority (B37) holds under staging
    }
  });

  it("the per-round approach re-asks as the field narrows while the player is still in (forward-only)", () => {
    // A clear FAVORITE survives deep, so the per-round prompt re-issues round after round (a single-round
    // comp would never exercise the narrowing). The crown is the single roll; the rounds are presentation.
    const ctx: SeasonCtx = { player: PLAYER, statsOf: (id) => (id === PLAYER ? flat(0.95) : flat(0.4)), rel: new RelationshipModel(0.5) };
    const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)]);
    const rng = new SeededRandom(4);
    const seenRounds: number[] = [];
    for (let g = 0; g < 40 && !s.hoh; g++) {
      if (s.pending?.kind === "comp-round") {
        // The pending carries WHO IS STILL IN this round + the round number — the field narrows.
        seenRounds.push(s.pending.round);
        expect(s.pending.stillIn).toContain(PLAYER); // the player only chooses while still in
        applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng);
      } else {
        advance(s, ctx, rng);
      }
    }
    expect(seenRounds.length).toBeGreaterThan(1); // a multi-round, narrowing comp (visible elimination rounds)
    // Round numbers are strictly forward — adaptation is forward-only, never a re-label of a past round.
    for (let i = 1; i < seenRounds.length; i++) expect(seenRounds[i]!).toBeGreaterThan(seenRounds[i - 1]!);
  });

  it("a late comp-round approach (after the crown) is a no-op — the round is locked", () => {
    const ctx: SeasonCtx = { player: PLAYER, statsOf: () => flat(0.5), rel: new RelationshipModel(0.5) };
    const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4)]);
    const rng = new SeededRandom(3);
    for (let g = 0; g < 40 && !s.hoh; g++) {
      if (s.pending?.kind === "comp-round") applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng);
      else advance(s, ctx, rng);
    }
    const crowned = s.hoh!;
    expect(crowned).toBeDefined();
    // No comp-round is pending now (the beat moved to nominations) — a late approach is refused.
    expect(() => applyDecision(s, { kind: "comp-round", intent: "throw" }, ctx, rng)).toThrow();
    expect(s.hoh).toBe(crowned); // the crown stands
  });
});
