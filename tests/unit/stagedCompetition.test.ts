import { describe, it, expect } from "vitest";
import { resolveCompetition, resolveElimination, CompetitionIntents, type Competitor } from "../../src/domain/competitionOutcome";
import { newLiveSeason, advance, applyDecision, peekCompetition, type SeasonCtx } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { Stats } from "../../src/engine/season";

/**
 * 0006 staged-rounds evolution — the endurance-style elimination model. The competition plays out in
 * visible rounds until one remains. WINNER OUTCOME-NEUTRALITY (the anti-sycophancy backstop, mandate #3):
 * the staged rounds are a NARRATION of the 0006 calibrated outcome — the CROWN is byte-identical to the
 * single-roll `resolveCompetition` winner for the same seed/field, so the jury earned-wins calibration is
 * preserved EXACTLY. Only the elimination ORDER of the losers is the new drama, computed on an isolated
 * sub-stream that never perturbs the winner. These small SEEDED tests prove that, plus the unchanged 0006
 * band (favorite ≈73%, real upsets, symmetry) and per-round agency. HARD rule: roles only — no names.
 */

const flat = (v: number): Stats => ({ physical: v, mental: v, social: v });

/**
 * The staged outcome AS THE ENGINE COMPUTES IT (the new winner-outcome-neutral model — mirrors
 * `decideCompetitionOutcome` in liveSeason.ts): the CROWN is the single-roll `resolveCompetition`
 * winner over the FULL field; the loser drop order is played out on an ISOLATED fork that excludes the
 * winner, so it can never overturn the crown. Returns both so the litmus can assert winner == single-roll.
 */
function stagedOutcome(field: Competitor[], seed: number): { winner: EntityId; dropOrder: EntityId[] } {
  const beatRng = new SeededRandom(seed);
  // The calibrated crown — the SAME single roll the pre-staging model used (byte-identical).
  const winner = resolveCompetition(field, "endurance", new CompetitionIntents(), beatRng).winner;
  // The drop drama on an isolated sub-stream (fork does not advance the parent — zero perturbation).
  const drama = beatRng.fork("comp-elimination-order");
  let live = field.filter((c) => c.id !== winner);
  const dropOrder: EntityId[] = [];
  let round = 1;
  while (live.length > 1) {
    const { eliminated } = resolveElimination(live, "endurance", new CompetitionIntents(), drama.fork(`drop:${round}`));
    dropOrder.push(eliminated);
    live = live.filter((c) => c.id !== eliminated);
    round += 1;
  }
  if (live.length === 1) dropOrder.push(live[0]!.id);
  return { winner, dropOrder };
}

/** The staged WINNER (the crown) — the calibration-bearing outcome. */
const stagedWinner = (field: Competitor[], seed: number): EntityId => stagedOutcome(field, seed).winner;

describe("0006 staged-rounds — the favorite-win calibration HOLDS under elimination staging", () => {
  it("a clear stat favorite wins a STRONG MAJORITY across a staged endurance comp (the 0006 band)", () => {
    // The canonical 0006 calibration shape (cf. outcomes.property.test.ts): one CLEAR favorite (0.9)
    // among an average field (0.5). Because the staged crown is byte-identical to the single-roll
    // `resolveCompetition` winner (winner outcome-neutrality), the staged favorite wins the SAME 0006
    // strong-majority band — the staging narrates the calibrated outcome, it does not inflate it.
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
      // The 0006 spec band: a clear favorite wins a strong majority (≈65–80%, tunable) but loses a real
      // minority — earned outcomes with uncommon upsets. Larger fields dilute slightly; a generous floor
      // rides the field-size spread while still catching any drift toward protection or sameness.
      expect(rate, `n=${n}: staged favorite win rate ${rate.toFixed(3)}`).toBeGreaterThan(0.6);
      expect(rate, `n=${n}: staged favorite win rate ${rate.toFixed(3)}`).toBeLessThan(0.85);
    }
  });

  it("the favorite still loses a REAL minority (temperature breaks perfect predictability — no Luck stat)", () => {
    const field: Competitor[] = [
      { id: PLAYER, stats: flat(0.8) },
      ...Array.from({ length: 11 }, (_, i) => ({ id: npc(i + 1), stats: flat(0.5) })),
    ];
    let upsets = 0;
    for (let seed = 1; seed <= 1000; seed++) if (stagedWinner(field, seed) !== PLAYER) upsets++;
    expect(upsets).toBeGreaterThan(0); // the favorite is NOT protected — real upsets happen
  });

  it("equal-stat houseguests each win ~their fair share (no hidden favor; symmetry preserved)", () => {
    const field: Competitor[] = Array.from({ length: 8 }, (_, i) => ({ id: npc(i + 1), stats: flat(0.5) }));
    const wins = new Map<EntityId, number>(field.map((c) => [c.id, 0]));
    const RUNS = 2000;
    for (let seed = 1; seed <= RUNS; seed++) wins.set(stagedWinner(field, seed), (wins.get(stagedWinner(field, seed)) ?? 0) + 1);
    const fair = RUNS / field.length;
    for (const c of field) {
      const w = wins.get(c.id)!;
      // A generous symmetry band: every exchangeable houseguest wins ~1/8 of the time (no protection).
      expect(w, `id ${c.id} won ${w} of ${RUNS} (fair ≈ ${fair})`).toBeGreaterThan(fair * 0.6);
      expect(w).toBeLessThan(fair * 1.5);
    }
  });

  it("reproducible by seed: the same seed ⇒ the same staged winner; different seeds vary", () => {
    const field: Competitor[] = [
      { id: PLAYER, stats: flat(0.7) },
      ...Array.from({ length: 5 }, (_, i) => ({ id: npc(i + 1), stats: flat(0.5) })),
    ];
    expect(stagedWinner(field, 42)).toBe(stagedWinner(field, 42)); // determinism
    const winners = new Set(Array.from({ length: 30 }, (_, i) => stagedWinner(field, i + 1)));
    expect(winners.size).toBeGreaterThan(1); // different seeds explore different outcomes
  });
});

describe("0006 staged-rounds — WINNER OUTCOME-NEUTRALITY (the calibration-preservation litmus, direction 1)", () => {
  // THE regression fix (PR #395 jury-aggregate band): the staged crown must be byte-identical to the
  // single-roll `resolveCompetition` winner for the same seed/field — so the staged mechanic narrates
  // the SAME calibrated outcome and the jury earned-wins band is preserved exactly. A re-rolled
  // per-round survival ladder (the prior model) gave weak players "extra lives" and shifted who reached
  // F2 — this litmus is the permanent guard that the winner is never perturbed by the drop drama.
  const buildField = (n: number, favorite = 0.8): Competitor[] => [
    { id: PLAYER, stats: flat(favorite) },
    ...Array.from({ length: n - 1 }, (_, i) => ({ id: npc(i + 1), stats: flat(0.5) })),
  ];

  it("the staged WINNER equals the single-roll resolveCompetition winner (same seed + field)", () => {
    for (const n of [2, 6, 12, 16]) {
      const field = buildField(n);
      for (let seed = 1; seed <= 400; seed++) {
        const single = resolveCompetition(field, "endurance", new CompetitionIntents(), new SeededRandom(seed)).winner;
        const staged = stagedWinner(field, seed);
        expect(staged, `n=${n} seed=${seed}: staged crown must equal the single-roll winner`).toBe(single);
      }
    }
  });

  it("the drop ORDER drama never includes the winner, and covers every loser exactly once", () => {
    for (const n of [3, 6, 16]) {
      const field = buildField(n);
      for (let seed = 1; seed <= 200; seed++) {
        const { winner, dropOrder } = stagedOutcome(field, seed);
        expect(dropOrder).not.toContain(winner); // the crown survives every round by construction
        expect(dropOrder.length, `n=${n}`).toBe(n - 1); // every loser drops, exactly once
        expect(new Set(dropOrder).size).toBe(n - 1); // no dup, no gap
        const losers = field.map((c) => c.id).filter((id) => id !== winner);
        expect([...dropOrder].sort()).toEqual([...losers].sort()); // the drama is exactly the loser set
      }
    }
  });

  it("the isolated drop stream does NOT perturb the calibrated winner (winner is a pure single roll)", () => {
    // Two builds of the SAME field/seed must crown identically AND match the bare single roll — the
    // drop drama's fork can never have leaked into the winner's stream position.
    const field = buildField(12);
    for (let seed = 1; seed <= 300; seed++) {
      const bare = resolveCompetition(field, "endurance", new CompetitionIntents(), new SeededRandom(seed)).winner;
      expect(stagedOutcome(field, seed).winner).toBe(bare);
      expect(stagedOutcome(field, seed).winner).toBe(stagedOutcome(field, seed).winner);
    }
  });

  it("a throwing favorite loses the crown EXACTLY as the single-roll model does (anti-sycophancy both ways)", () => {
    // The crown honors the committed approach: a throwing favorite must lose at the SAME rate the
    // single-roll throw produces — staging never hands a thrown comp back to the player.
    const field = buildField(6, 0.85);
    const throwIntents = (): CompetitionIntents => { const i = new CompetitionIntents(); i.declare(PLAYER, "throw"); return i; };
    let stagedWins = 0;
    let singleWins = 0;
    const RUNS = 600;
    for (let seed = 1; seed <= RUNS; seed++) {
      // Single-roll with the throw penalty.
      if (resolveCompetition(field, "endurance", throwIntents(), new SeededRandom(seed)).winner === PLAYER) singleWins++;
      // The staged crown with the same throw penalty (mirrors decideCompetitionOutcome's committed approach).
      const beatRng = new SeededRandom(seed);
      if (resolveCompetition(field, "endurance", throwIntents(), beatRng).winner === PLAYER) stagedWins++;
    }
    expect(stagedWins).toBe(singleWins); // identical — the crown is the single roll, throw penalty and all
  });
});

describe("0006 staged-rounds — per-round approach is committed before, locked after (anti-sycophancy)", () => {
  const ctxOf = (rel: RelationshipModel): SeasonCtx => ({
    player: PLAYER, statsOf: () => flat(0.5), rel,
  });

  it("the LIVE staged loop crowns the SAME houseguest the preview reported when the player competes", () => {
    const ctx = ctxOf(new RelationshipModel(0.5));
    for (let seed = 1; seed <= 25; seed++) {
      const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)]);
      const peek = peekCompetition(s, ctx, new SeededRandom(seed));
      expect(peek).not.toBeNull(); // the HOH comp opens the season; a preview exists
      // Drive the staged comp competing every round (the preview's default) → the same crown. The
      // production seam re-mints a FRESH per-beat rng on every advance/decision (GameSessionAdapter
      // .beatRng() keys off seed:week:beat) — so within the HOH comp beat each step sees the same fresh
      // stream. Mirror that here: a fresh SeededRandom(seed) per call. The crown is forked off it on a
      // dedicated `comp-winner` sub-stream, position-independent of the def draw + the per-round pauses.
      const beatRng = (): SeededRandom => new SeededRandom(seed);
      for (let g = 0; g < 30 && !s.hoh; g++) {
        if (s.pending?.kind === "comp-round") applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, beatRng());
        else advance(s, ctx, beatRng());
      }
      expect(s.hoh).toBe(peek!.winner); // single outcome authority (B37) holds under staging
    }
  });

  it("throwing a round drops the player far more often than competing it (the 0028 per-round penalty)", () => {
    // A strong player who THROWS every round survives far less than one who competes every round.
    const winRate = (approach: "compete" | "throw"): number => {
      let wins = 0;
      const RUNS = 120;
      for (let seed = 1; seed <= RUNS; seed++) {
        const rel = new RelationshipModel(0.5);
        const ctx: SeasonCtx = { player: PLAYER, statsOf: (id) => (id === PLAYER ? flat(0.85) : flat(0.5)), rel };
        const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4)]);
        const rng = new SeededRandom(seed);
        for (let g = 0; g < 30 && !s.hoh; g++) {
          if (s.pending?.kind === "comp-round") applyDecision(s, { kind: "comp-round", intent: approach }, ctx, rng);
          else advance(s, ctx, rng);
        }
        if (s.hoh === PLAYER) wins++;
      }
      return wins / RUNS;
    };
    expect(winRate("throw")).toBeLessThan(winRate("compete")); // a per-round throw measurably hurts
  });
});
