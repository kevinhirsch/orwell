import { describe, it, expect } from "vitest";
import { simulateSeason } from "../../src/engine/simulation";
import { richnessMetrics } from "../../src/engine/richness";
import { RICHNESS } from "../../src/engine/richnessConfig";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

describe("behavioral fidelity — richness thresholds hold across seeds", () => {
  it("every metric holds for many seeds", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = richnessMetrics(simulateSeason({ rng: new SeededRandom(seed) }));
      const ctx = `seed ${seed}: ${JSON.stringify(m)}`;
      expect(m.offscreenShare, ctx).toBeGreaterThanOrEqual(RICHNESS.MIN_OFFSCREEN_SHARE);
      expect(m.typeDiversity, ctx).toBeGreaterThanOrEqual(RICHNESS.MIN_TYPE_DIVERSITY);
      expect(m.alliancesFormed, ctx).toBeGreaterThanOrEqual(1);
      expect(m.alliancesFractured, ctx).toBeGreaterThanOrEqual(1);
      expect(m.edgeStrengthsChanged, ctx).toBe(true);
      expect(m.surfacingRate, ctx).toBeGreaterThan(0);
      expect(m.surfacingRate, ctx).toBeLessThanOrEqual(RICHNESS.MAX_SURFACING_RATE);
      expect(m.maxRevealsPerMoment, ctx).toBeLessThanOrEqual(RICHNESS.MAX_REVEALS_PER_MOMENT);
    }
  });
});
