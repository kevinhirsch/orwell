import { describe, it, expect } from "vitest";
import { resolveCompetition, CompetitionIntents, type Competitor } from "../../src/domain/competitionOutcome";
import { TEMPERATURE_CONSTANTS as TC } from "../../src/domain/temperatureConstants";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * Feature 0098 — confidence-calibrated reads: the pure DOMAIN term only. When a competitor carries a
 * hidden `conviction < 1` (how sure the player is of the read they act on), the engine WIDENS that
 * competitor's SEEDED temperature span SYMMETRICALLY about its unchanged center and lets the same seeded
 * roll decide. Bold correct reads pay off bigger, blind faith craters harder — but the engine NEVER aims
 * the result (mean-preserving, symmetric, seeded); it never reads whether the belief is TRUE. It is
 * BYTE-IDENTICAL at conviction 1/undefined (the calibration spine is unmoved). Roles only — no names.
 *
 * NOTE (build posture): NO live caller passes a `conviction` — the adapter pass-through is deliberately
 * OWNER-GATED pending re-ratification of the frozen spec's standing principle ("a player input must never
 * modulate a seeded outcome distribution — not even the variance"). This file proves the DOMAIN term is
 * correct, bounded, mean-preserving, and inert-by-default; it does not wire it into live play.
 */

const EVEN = { physical: 0.6, mental: 0.6, social: 0.6 };
const BASE = EVEN.physical * TC.outcome.stat; // the constant center of an EVEN "compete" score

/** A single competitor's score across `n` seeds at a given conviction (isolates the temperature term). */
function scoreSamples(conviction: number | undefined, n: number): number[] {
  const out: number[] = [];
  for (let seed = 0; seed < n; seed++) {
    const c: Competitor = { id: "hg", stats: EVEN, conviction };
    const r = resolveCompetition([c], "physical", new CompetitionIntents(), new SeededRandom(seed));
    out.push(r.scores["hg"]!);
  }
  return out;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: number[]): number => {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
};

describe("0098 — conviction is byte-identical at the baseline (the calibration spine is unmoved)", () => {
  it("an OMITTED conviction matches an explicit conviction=1 for every seed (winner + scores)", () => {
    for (let seed = 0; seed < 400; seed++) {
      const field = (conv?: number): Competitor[] => [
        { id: "a", stats: EVEN, conviction: conv },
        { id: "b", stats: { physical: 0.7, mental: 0.5, social: 0.6 }, conviction: conv },
      ];
      const omitted = resolveCompetition(field(undefined), "physical", new CompetitionIntents(), new SeededRandom(seed));
      const explicitOne = resolveCompetition(field(1), "physical", new CompetitionIntents(), new SeededRandom(seed));
      expect(omitted.winner).toBe(explicitOne.winner);
      expect(omitted.scores).toEqual(explicitOne.scores);
      expect(omitted.temperature).toEqual(explicitOne.temperature); // the raw seeded draw is untouched
    }
  });

  it("conviction=1 is byte-identical to the pre-0098 model (no conviction field at all)", () => {
    for (let seed = 0; seed < 400; seed++) {
      const pre = resolveCompetition([{ id: "x", stats: EVEN }], "physical", new CompetitionIntents(), new SeededRandom(seed));
      const one = resolveCompetition([{ id: "x", stats: EVEN, conviction: 1 }], "physical", new CompetitionIntents(), new SeededRandom(seed));
      expect(one.scores).toEqual(pre.scores);
    }
  });
});

describe("0098 — lower conviction widens the seeded band (variance rises, mean holds)", () => {
  const N = 4000;

  it("variance rises monotonically as conviction falls", () => {
    const vHigh = variance(scoreSamples(1, N));
    const vMid = variance(scoreSamples(0.5, N));
    const vLow = variance(scoreSamples(0, N));
    expect(vMid).toBeGreaterThan(vHigh);
    expect(vLow).toBeGreaterThan(vMid);
  });

  it("the widening is ~symmetric and quadratic in the span factor (var(0) ≈ 4× var(1))", () => {
    // factor(1)=1, factor(0)=1 + gain·1 = 2 (capped at 2.5) ⇒ variance scales by factor² ⇒ 4×.
    const vHigh = variance(scoreSamples(1, N));
    const vLow = variance(scoreSamples(0, N));
    const ratio = vLow / vHigh;
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });

  it("is MEAN-PRESERVING — the expected outcome is unchanged across conviction (only variance differs)", () => {
    // The engine never aims the result: over many seeds a low-conviction action has the SAME expected
    // outcome as a fully-confident one. (Both share the seed stream, so the tiny gap is w.temp·(f−1)·E[temp].)
    const mHigh = mean(scoreSamples(1, N));
    const mLow = mean(scoreSamples(0, N));
    expect(Math.abs(mLow - mHigh)).toBeLessThan(0.02);
  });

  it("blind faith fattens BOTH tails — bigger win AND bigger crater, symmetrically", () => {
    const high = scoreSamples(1, N);
    const low = scoreSamples(0, N);
    expect(Math.max(...low)).toBeGreaterThan(Math.max(...high)); // a bigger clutch win is possible
    expect(Math.min(...low)).toBeLessThan(Math.min(...high));    // a bigger crater is equally possible
  });
});

describe("0098 — the swing stays bounded (temperature never overrides the stat anchor)", () => {
  it("even total blind faith never swings past the hard ceiling", () => {
    // The widened temperature contribution = temp · w.temperature · factor, and |temp| ≤ bound.max,
    // factor ≤ convictionVarianceCap. So |score − center| can never exceed the ceiling below.
    const ceiling = TC.bound.max * TC.outcome.temperature * TC.outcome.convictionVarianceCap;
    for (const s of scoreSamples(0, 4000)) {
      expect(Math.abs(s - BASE)).toBeLessThanOrEqual(ceiling + 1e-9);
    }
  });

  it("a favorite acting on a hunch is more upset-prone but the stat still anchors the center", () => {
    // A strong favorite at conviction=0 (max variance) still has a HIGHER mean score than a weak player at
    // conviction=1 — the widening fattens the tails, it does not flip the archetype-grounded center.
    const N = 4000;
    const favSamples: number[] = [];
    const dogSamples: number[] = [];
    for (let seed = 0; seed < N; seed++) {
      const fav = resolveCompetition([{ id: "fav", stats: { physical: 0.9, mental: 0.9, social: 0.9 }, conviction: 0 }], "physical", new CompetitionIntents(), new SeededRandom(seed));
      const dog = resolveCompetition([{ id: "dog", stats: { physical: 0.5, mental: 0.5, social: 0.5 }, conviction: 1 }], "physical", new CompetitionIntents(), new SeededRandom(seed));
      favSamples.push(fav.scores["fav"]!);
      dogSamples.push(dog.scores["dog"]!);
    }
    expect(mean(favSamples)).toBeGreaterThan(mean(dogSamples));
  });
});

describe("0098 — malformed input is a refusal, never a silent fix (anti-sycophancy)", () => {
  it("refuses a non-finite conviction", () => {
    expect(() =>
      resolveCompetition([{ id: "a", stats: EVEN, conviction: NaN }], "physical", new CompetitionIntents(), new SeededRandom(1)),
    ).toThrow(/conviction/);
    expect(() =>
      resolveCompetition([{ id: "a", stats: EVEN, conviction: Infinity }], "physical", new CompetitionIntents(), new SeededRandom(1)),
    ).toThrow(/conviction/);
  });

  it("an out-of-range but finite conviction is clamped (never NARROWS below the baseline band)", () => {
    // conviction > 1 would compute a factor < 1 (a narrower band) — the clamp floors it at the baseline,
    // so an over-confident read is never LESS variable than a witnessed one.
    for (let seed = 0; seed < 200; seed++) {
      const over = resolveCompetition([{ id: "x", stats: EVEN, conviction: 5 }], "physical", new CompetitionIntents(), new SeededRandom(seed));
      const one = resolveCompetition([{ id: "x", stats: EVEN, conviction: 1 }], "physical", new CompetitionIntents(), new SeededRandom(seed));
      expect(over.scores).toEqual(one.scores);
    }
  });
});
