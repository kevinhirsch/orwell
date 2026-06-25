import { describe, it, expect } from "vitest";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import {
  generateHouse, startNewGame, isPlausibleHouseguest, ENSEMBLE, NPC_COUNT, CAST_SIZE,
} from "../../src/engine/characterFactory";

describe("replayability & naming — invariants across seeds", () => {
  it("every house is a valid, varied, uniquely-named 16-cast", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { player, npcs } = startNewGame({ seed, playerName: "AuthoredPlayer" });
      const ctx = `seed ${seed}`;
      expect(1 + npcs.length, ctx).toBe(CAST_SIZE);
      expect(npcs.length, ctx).toBe(NPC_COUNT);
      expect(player.authored, ctx).toBe("oobe");
      expect(npcs.every((n) => n.authored === "generated"), ctx).toBe(true);
      expect(npcs.every(isPlausibleHouseguest), ctx).toBe(true);

      const names = [player.name, ...npcs.map((n) => n.name)];
      expect(new Set(names).size, ctx).toBe(names.length);

      const archetypes = new Set(npcs.map((n) => n.character.archetype));
      expect(archetypes.size, ctx).toBeGreaterThanOrEqual(ENSEMBLE.MIN_DISTINCT_ARCHETYPES);
      const counts = new Map<string, number>();
      for (const n of npcs) counts.set(n.character.archetype, (counts.get(n.character.archetype) ?? 0) + 1);
      expect(Math.max(...counts.values()), ctx).toBeLessThanOrEqual(ENSEMBLE.MAX_PER_ARCHETYPE);
    }
  });

  it("no two houseguests in a house share a surname (#853)", () => {
    // Property over generated output ONLY — never seeded from sample names (HARD testing rule).
    // The surname is the SECOND whitespace-delimited token of a two-token corpus display name.
    for (let seed = 1; seed <= 50; seed++) {
      const { npcs } = generateHouse(new SeededRandom(seed));
      const surnames = npcs.map((n) => n.name.split(" ")[1]);
      // Every NPC has a surname token, and the set of surnames is collision-free across the cast.
      expect(surnames.every((s) => typeof s === "string" && s.length > 0), `seed ${seed}`).toBe(true);
      expect(new Set(surnames).size, `seed ${seed} should have no duplicate surnames`).toBe(surnames.length);
    }
  });

  it("same seed is reproducible; different seeds share no identities", () => {
    const a1 = generateHouse(new SeededRandom(7)).npcs.map((n) => n.name);
    const a2 = generateHouse(new SeededRandom(7)).npcs.map((n) => n.name);
    expect(a2).toEqual(a1);

    for (const [s1, s2] of [[1, 2], [2, 3], [3, 4], [10, 99]]) {
      const set1 = new Set(generateHouse(new SeededRandom(s1)).npcs.map((n) => n.name));
      const shared = generateHouse(new SeededRandom(s2)).npcs.filter((n) => set1.has(n.name));
      expect(shared, `seeds ${s1}/${s2} should be disjoint`).toEqual([]);
    }
  });
});
