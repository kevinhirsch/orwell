import { describe, it, expect } from "vitest";
import { resolveCompetition, CompetitionIntents } from "../../src/domain/competitionOutcome";
import type { Competitor, CompetitionType } from "../../src/domain/competitionOutcome";
import { withinBounds } from "../../src/domain/temperature";
import { npc, PLAYER } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

const flat = (v: number) => ({ physical: v, mental: v, social: v });
const RUNS = 800;

function winRate(field: () => Competitor[], type: CompetitionType, target: string): number {
  let wins = 0;
  for (let s = 1; s <= RUNS; s++) {
    const r = resolveCompetition(field(), type, new CompetitionIntents(), new SeededRandom(s));
    if (r.winner === target) wins++;
  }
  return wins / RUNS;
}

describe("outcomes by stats + temperature", () => {
  it("a clear favorite wins a strong majority but loses a real minority", () => {
    const field = (): Competitor[] => [
      { id: npc(1), stats: flat(0.9) },
      ...[2, 3, 4, 5, 6].map((i) => ({ id: npc(i), stats: flat(0.5) })),
    ];
    const rate = winRate(field, "endurance", npc(1));
    // B69: tightened toward the documented ~72% calibration (was a loose 65–80% that could
    // hide a drifted favorite weighting). RUNS=800 ⇒ sd≈1.6%, so ±5pp is noise-safe.
    expect(rate).toBeGreaterThanOrEqual(0.67);
    expect(rate).toBeLessThanOrEqual(0.77);
    expect(1 - rate).toBeGreaterThanOrEqual(0.1); // real, uncommon upsets
  });

  it("win rate reflects stats: a houseguest weak in the type rarely wins", () => {
    const field = (): Competitor[] => [
      { id: npc(1), stats: { physical: 0.2, mental: 0.5, social: 0.5 } }, // weak at endurance
      ...[2, 3, 4, 5, 6].map((i) => ({ id: npc(i), stats: { physical: 0.75, mental: 0.5, social: 0.5 } })),
    ];
    expect(winRate(field, "endurance", npc(1))).toBeLessThan(0.2);
  });

  it("the engine never protects the player", () => {
    const others = [2, 3, 4, 5, 6].map((i) => ({ id: npc(i), stats: flat(0.6) }));
    const asPlayer = (): Competitor[] => [{ id: PLAYER, stats: { physical: 0.3, mental: 0.5, social: 0.5 } }, ...others];
    const asNpc = (): Competitor[] => [{ id: npc(20), stats: { physical: 0.3, mental: 0.5, social: 0.5 } }, ...others];
    expect(winRate(asPlayer, "endurance", PLAYER)).toBe(winRate(asNpc, "endurance", npc(20)));
  });

  it("is reproducible by seed; temperature stays within bounds", () => {
    const field = (): Competitor[] => [1, 2, 3, 4, 5, 6].map((i) => ({ id: npc(i), stats: flat(0.5) }));
    for (let s = 1; s <= 200; s++) {
      const a = resolveCompetition(field(), "puzzle", new CompetitionIntents(), new SeededRandom(s));
      const b = resolveCompetition(field(), "puzzle", new CompetitionIntents(), new SeededRandom(s));
      expect(a.winner).toBe(b.winner);
      for (const v of Object.values(a.temperature)) expect(withinBounds(v)).toBe(true);
    }
  });
});
