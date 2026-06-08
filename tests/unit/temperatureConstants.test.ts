import { describe, it, expect } from "vitest";
import {
  TEMPERATURE_CONSTANTS,
  temperatureRoll,
  withinTemperatureBounds,
  emotionalModifier,
  hiddenSurfaces,
  type TemperatureConstants,
} from "../../src/domain/temperatureConstants";
import { resolveCompetition, CompetitionIntents } from "../../src/domain/competitionOutcome";
import type { Competitor, CompetitionType } from "../../src/domain/competitionOutcome";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc, PLAYER } from "../../src/domain/ids";

const flat = (v: number): { physical: number; mental: number; social: number } => ({ physical: v, mental: v, social: v });

function favoriteWinRate(
  favorite: string,
  field: () => Competitor[],
  constants: TemperatureConstants = TEMPERATURE_CONSTANTS,
  runs = 600,
): number {
  let wins = 0;
  for (let s = 1; s <= runs; s++) {
    if (resolveCompetition(field(), "endurance" as CompetitionType, new CompetitionIntents(), new SeededRandom(s), constants).winner === favorite) wins++;
  }
  return wins / runs;
}

describe("0028 — temperature & emotional-modifier constants (calibrated, tunable)", () => {
  it("the favorite wins a calibrated strong majority but loses real upsets", () => {
    const field = (): Competitor[] => [{ id: npc(1), stats: flat(0.9) }, ...[2, 3, 4, 5, 6].map((i) => ({ id: npc(i), stats: flat(0.5) }))];
    const rate = favoriteWinRate(npc(1), field);
    expect(rate).toBeGreaterThanOrEqual(0.65); // strong majority (~72%)
    expect(rate).toBeLessThanOrEqual(0.8);
    expect(1 - rate).toBeGreaterThanOrEqual(0.1); // genuine, uncommon upsets
  });

  it("never protects the player — a player favorite wins at the SAME rate as an NPC favorite", () => {
    const others = [2, 3, 4, 5, 6].map((i) => ({ id: npc(i), stats: flat(0.6) }));
    const asPlayer = (): Competitor[] => [{ id: PLAYER, stats: flat(0.3) }, ...others];
    const asNpc = (): Competitor[] => [{ id: npc(20), stats: flat(0.3) }, ...others];
    expect(favoriteWinRate(PLAYER, asPlayer)).toBe(favoriteWinRate(npc(20), asNpc));
  });

  it("temperature is bounded and reproducible by seed", () => {
    for (let s = 1; s <= 300; s++) {
      const a = temperatureRoll(new SeededRandom(s));
      const b = temperatureRoll(new SeededRandom(s));
      expect(a).toBe(b); // seed-reproducible
      expect(withinTemperatureBounds(a)).toBe(true); // within the configured bound
    }
  });

  it("the emotional modifier mean-reverts toward baseline after a spike", () => {
    const c = TEMPERATURE_CONSTANTS;
    const spiked = emotionalModifier(c.emotional.baseline, -1, 0.6, c); // an adverse spike
    expect(Math.abs(spiked - c.emotional.baseline)).toBeGreaterThan(0.1); // genuinely off baseline

    let mod = spiked;
    let prevDist = Math.abs(spiked - c.emotional.baseline);
    for (let i = 0; i < 8; i++) {
      mod = emotionalModifier(mod, 0, 0, c); // a calm moment
      const dist = Math.abs(mod - c.emotional.baseline);
      expect(dist).toBeLessThanOrEqual(prevDist); // monotonically settling
      prevDist = dist;
    }
    expect(Math.abs(mod - c.emotional.baseline)).toBeLessThan(Math.abs(spiked - c.emotional.baseline));
  });

  it("hidden elements surface rarely — present but at a low, bounded rate", () => {
    const N = 1000;
    let surfaced = 0;
    for (let s = 1; s <= N; s++) if (hiddenSurfaces(new SeededRandom(s))) surfaced++;
    const rate = surfaced / N;
    expect(rate).toBeGreaterThan(0); // present
    expect(rate).toBeLessThanOrEqual(0.15); // rare/bounded (config 0.05) — a treat, not a flood
  });

  it("retunable from the one module — and nothing is hard-coded outside it", () => {
    const field = (): Competitor[] => [{ id: npc(1), stats: flat(0.9) }, ...[2, 3, 4, 5, 6].map((i) => ({ id: npc(i), stats: flat(0.5) }))];
    const base = favoriteWinRate(npc(1), field);

    // A wider temperature bound ⇒ more variance ⇒ the favorite wins LESS often.
    const wide: TemperatureConstants = { ...TEMPERATURE_CONSTANTS, bound: { min: -3, max: 3 } };
    expect(favoriteWinRate(npc(1), field, wide)).toBeLessThan(base);

    // Zero the temperature weight ⇒ pure stat ⇒ the favorite ALWAYS wins (no hidden temperature term).
    const noTemp: TemperatureConstants = { ...TEMPERATURE_CONSTANTS, outcome: { ...TEMPERATURE_CONSTANTS.outcome, temperature: 0 } };
    expect(favoriteWinRate(npc(1), field, noTemp)).toBe(1);
  });
});
