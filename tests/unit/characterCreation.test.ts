import { describe, it, expect } from "vitest";
import {
  runPlayerOOBE, startNewGame, generateHouse, ARCHETYPES,
  NPC_STAT_RANGE, playerAptitudesWithinNpcBounds,
} from "../../src/engine/characterFactory";
import { resolveCompetition, CompetitionIntents } from "../../src/domain/competitionOutcome";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

describe("0015 — character creation (OOBE)", () => {
  it("validates: an incomplete profile is rejected, a complete one is consistent", () => {
    expect(() => runPlayerOOBE({ name: "" })).toThrow();
    expect(() => runPlayerOOBE({ name: "   " })).toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => runPlayerOOBE({} as any)).toThrow();
    const p = runPlayerOOBE({ name: "Author", archetype: "mastermind", strategyStyle: "strategic" });
    expect(p.authored).toBe("oobe");
    expect(p.character.archetype).toBe("mastermind");
    expect(p.character.strategyStyle).toBe("strategic");
  });

  it("splits the player into a static Character + an initial Soul with no relationship beliefs", () => {
    const p = runPlayerOOBE({ name: "Author", backstory: "a long road here" });
    expect(p.character.stats).toBeDefined();
    expect(p.character.background).toContain("long road");
    expect(p.soul.emotionalBaseline).toBeGreaterThanOrEqual(0);
    expect(p.soul.memory).toEqual([]); // empty memory; relationship beliefs are NOT stored on the soul
    expect(Object.keys(p.soul).sort()).toEqual(["emotionalBaseline", "emotionalState", "memory", "volatility"]);
  });

  it("anti-sycophancy: authored aptitudes always fall within the NPC bounds (no min-maxing)", () => {
    for (const spec of ARCHETYPES) {
      const p = runPlayerOOBE({ name: "MaxMe", archetype: spec.archetype });
      expect(playerAptitudesWithinNpcBounds(p)).toBe(true);
      for (const v of Object.values(p.character.stats)) {
        expect(v).toBeGreaterThanOrEqual(NPC_STAT_RANGE.min);
        expect(v).toBeLessThanOrEqual(NPC_STAT_RANGE.max);
      }
    }
  });

  it("seeds exactly one authored profile (player) + 15 generated NPCs", () => {
    const house = startNewGame({ seed: 1, playerName: "Author" });
    expect(house.player.authored).toBe("oobe");
    expect(house.npcs).toHaveLength(15);
    expect(house.npcs.every((n) => n.authored === "generated")).toBe(true);
  });

  it("no carryover: two saves share no houseguest identities", () => {
    const a = startNewGame({ seed: 1, playerName: "Author" });
    const b = startNewGame({ seed: 2, playerName: "Author" });
    const an = new Set(a.npcs.map((n) => n.name));
    const overlap = b.npcs.filter((n) => an.has(n.name));
    expect(overlap).toHaveLength(0);
  });

  it("no outcome protection: the authored player can and does lose seeded competitions", () => {
    const house = startNewGame({ seed: 3, playerName: "Author", archetype: "floater" });
    const field = [
      { id: house.player.id, stats: house.player.character.stats, emotionalState: 0.5 },
      ...house.npcs.map((n) => ({ id: n.id, stats: n.character.stats, emotionalState: n.soul.emotionalState })),
    ];
    let playerWins = 0;
    for (let s = 1; s <= 60; s++) {
      const { winner } = resolveCompetition(field, "endurance", new CompetitionIntents(), new SeededRandom(s));
      if (winner === house.player.id) playerWins++;
    }
    expect(playerWins).toBeLessThan(60); // unprotected — the player loses real competitions
  });

  it("the house is a balanced ensemble (a spread of archetypes, not a clump)", () => {
    const { npcs } = generateHouse(new SeededRandom(9));
    const archetypes = new Set(npcs.map((n) => n.character.archetype));
    expect(archetypes.size).toBeGreaterThanOrEqual(5);
  });
});
