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

  it("a clear stat favorite wins a MAJORITY but upsets are common (PO review 2026-06-28: ~50–70% band)", () => {
    // PO ruling: raw comp stats should not dominate now that emotions (0041) + sleep (0066) add depth.
    // temperature 0.36→0.40 lowers a clear favorite (0.9 vs a 0.5 field) from the old 60–71% to ~55–66%
    // across field sizes — still the strong favorite (many multiples of a fair 1/n share), but upsets a
    // tad more common. The band widens to 0.50–0.72 (larger fields land lower — more challengers).
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
      expect(rate, `n=${n}: favorite win rate ${rate.toFixed(3)}`).toBeGreaterThan(0.5);
      expect(rate, `n=${n}: favorite win rate ${rate.toFixed(3)}`).toBeLessThan(0.72);
      // Still clearly the favorite: many multiples of an even 1/n split.
      expect(rate, `n=${n}: favorite dominance vs fair share`).toBeGreaterThan((1 / n) * 3);
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

describe("0006 staged-rounds — the up-front approach is committed before, locked after (anti-sycophancy)", () => {
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

  it("the approach is asked ONCE, up front — later rounds do not re-prompt (PO review 2026-06-28)", () => {
    // A clear FAVORITE survives deep, so under the OLD model the per-round prompt re-issued round after
    // round. Now intent is a SINGLE up-front decision; the elimination rounds play out (the field still
    // narrows as drama) without ever pausing the player again.
    const ctx: SeasonCtx = { player: PLAYER, statsOf: (id) => (id === PLAYER ? flat(0.95) : flat(0.4)), rel: new RelationshipModel(0.5) };
    const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)]);
    const rng = new SeededRandom(4);
    let prompts = 0;
    for (let g = 0; g < 40 && !s.hoh; g++) {
      if (s.pending?.kind === "comp-round") {
        prompts++;
        expect(s.pending.round).toBe(1);             // the ONLY prompt is round 1 (up front)
        expect(s.pending.binding).toBe(true);        // and it BINDS (it is the intent the roll honors)
        expect(s.pending.stillIn).toContain(PLAYER);
        applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng);
      } else {
        advance(s, ctx, rng);
      }
    }
    expect(s.hoh).toBeDefined(); // the comp still crowns — the drama played out
    expect(prompts).toBe(1);     // asked exactly once — no per-round re-prompt
  });

  it("FEWER, BIGGER rounds (audit 2026-06-20): a large field resolves in ≤8 staged rounds, not one-per-houseguest", () => {
    // Pre-fix a 16-player HOH dropped one houseguest per round = ~15 rounds (a slog, repeated for the
    // veto every week). Batched drops cap it near the 4-8 band. The CROWN + drop order are unchanged
    // (presentation only) — the calibration tests above still hold; this only pins the round COUNT.
    const ctx: SeasonCtx = { player: PLAYER, statsOf: (id) => (id === PLAYER ? flat(0.95) : flat(0.4)), rel: new RelationshipModel(0.5) };
    const s = newLiveSeason([PLAYER, ...Array.from({ length: 15 }, (_, i) => npc(i + 1))]); // 16-player field
    const rng = new SeededRandom(7);
    let maxRound = 0;
    for (let g = 0; g < 80 && !s.hoh; g++) {
      if (s.competition) maxRound = Math.max(maxRound, s.competition.round);
      if (s.pending?.kind === "comp-round") applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng);
      else advance(s, ctx, rng);
    }
    expect(s.hoh).toBeDefined();
    expect(maxRound, `staged rounds=${maxRound}`).toBeGreaterThanOrEqual(2); // still multi-round drama
    expect(maxRound, `staged rounds=${maxRound}`).toBeLessThanOrEqual(8);    // NOT the ~15-round slog
  });

  it("intent is a SINGLE binding prompt — no later non-binding flavor prompts (PO review 2026-06-28)", () => {
    // The single up-front roll honors round 1's approach; the later per-round flavor prompts were REMOVED
    // (they were color over an already-decided result and only added clicks). The player is asked exactly
    // once, and that one prompt binds.
    const ctx: SeasonCtx = { player: PLAYER, statsOf: (id) => (id === PLAYER ? flat(0.95) : flat(0.4)), rel: new RelationshipModel(0.5) };
    const s = newLiveSeason([PLAYER, ...Array.from({ length: 15 }, (_, i) => npc(i + 1))]);
    const rng = new SeededRandom(7);
    const bindings: boolean[] = [];
    for (let g = 0; g < 80 && !s.hoh; g++) {
      if (s.pending?.kind === "comp-round") {
        bindings.push(s.pending.binding);
        applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng);
      } else advance(s, ctx, rng);
    }
    expect(bindings).toEqual([true]); // exactly one prompt, and it binds — no per-round flavor prompts
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
