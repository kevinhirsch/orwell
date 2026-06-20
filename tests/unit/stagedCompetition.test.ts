import { describe, it, expect } from "vitest";
import { resolveElimination, CompetitionIntents, type Competitor } from "../../src/domain/competitionOutcome";
import { newLiveSeason, advance, applyDecision, peekCompetition, type SeasonCtx } from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import type { Stats } from "../../src/engine/season";

/**
 * 0006 staged-rounds evolution — the endurance-style elimination model. The competition plays out in
 * visible rounds (lowest score drops each round) until one remains. These small SEEDED tests prove the
 * 0006 calibration HOLDS under staging: a clear stat favorite still wins a strong majority but loses a
 * real minority, the result is reproducible by seed, and per-round resolution is locked (anti-sycophancy).
 * HARD rule: roles only — no names.
 */

const flat = (v: number): Stats => ({ physical: v, mental: v, social: v });

/** A staged ENDURANCE comp over `field`, eliminating the lowest each round; returns the winner. Pure. */
function stagedWinner(field: Competitor[], seed: number): EntityId {
  const rng = new SeededRandom(seed);
  let live = [...field];
  let round = 1;
  while (live.length > 1) {
    const { eliminated } = resolveElimination(live, "endurance", new CompetitionIntents(), rng.fork(`r:${round}`));
    live = live.filter((c) => c.id !== eliminated);
    round += 1;
  }
  return live[0]!.id;
}

describe("0006 staged-rounds — the favorite-win calibration HOLDS under elimination staging", () => {
  it("a clear stat favorite wins a STRONG MAJORITY across a staged endurance comp (the 0006 band)", () => {
    // One clear favorite (0.8) among an average field (0.5) — the canonical 0006 calibration shape.
    const buildField = (n: number): Competitor[] => [
      { id: PLAYER, stats: flat(0.8) },
      ...Array.from({ length: n - 1 }, (_, i) => ({ id: npc(i + 1), stats: flat(0.5) })),
    ];
    for (const n of [6, 12, 16]) {
      const field = buildField(n);
      let favWins = 0;
      const RUNS = 1500;
      for (let seed = 1; seed <= RUNS; seed++) if (stagedWinner(field, seed) === PLAYER) favWins++;
      const rate = favWins / RUNS;
      // The 0006 spec band: a clear favorite wins a strong majority (≈65–80%, tunable) but loses a real
      // minority — earned outcomes with uncommon upsets. The staged ladder sits squarely inside it.
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
      // Drive the staged comp competing every round (the preview's default) → the same crown.
      const rng = new SeededRandom(seed);
      for (let g = 0; g < 30 && !s.hoh; g++) {
        if (s.pending?.kind === "comp-round") applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng);
        else advance(s, ctx, rng);
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
