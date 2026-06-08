import { describe, it, expect } from "vitest";
import { newGameState, advanceGame } from "../../src/engine/gameProgression";
import { InMemorySaveStore } from "../../src/adapters/inmemory/InMemorySaveStore";
import { serialize, deserialize, isSuperset, counts, countsNonDecreasing } from "../../src/domain/saveState";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

describe("persistence non-degradation", () => {
  it("round-trips losslessly, supersets every prior save, never regresses counts, co-versions", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const rng = new SeededRandom(seed);
      const state = newGameState(rng);
      const store = new InMemorySaveStore();
      const snaps = [];

      for (let k = 0; k < 6; k++) {
        advanceGame(state, rng, `k${k}`);
        const ref = store.save(state);
        expect(ref.vaultVersion, `seed ${seed}`).toBe(ref.journalVersion); // co-versioned
        snaps.push(store.load(ref));
      }

      expect(deserialize(serialize(state))).toEqual(state); // lossless

      for (let i = 1; i < snaps.length; i++) {
        expect(isSuperset(snaps[i]!, snaps[i - 1]!), `seed ${seed} save ${i}`).toBe(true);
        expect(countsNonDecreasing(counts(snaps[i]!), counts(snaps[i - 1]!))).toBe(true);
      }
    }
  });

  it("the dynamic soul deepens while the static character baseline holds", () => {
    const rng = new SeededRandom(7);
    const state = newGameState(rng);
    const store = new InMemorySaveStore();
    const early = store.load(store.save(state));
    for (let k = 0; k < 25; k++) advanceGame(state, rng, `d${k}`);
    const late = store.load(store.save(state));

    expect(counts(late).soulMemory).toBeGreaterThan(counts(early).soulMemory + 50);
    expect(counts(late).soulHistory).toBeGreaterThan(counts(early).soulHistory + 50);
    expect(late.characters).toEqual(early.characters);
  });
});
