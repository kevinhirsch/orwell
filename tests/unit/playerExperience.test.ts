import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { generateHouse, portraitDescriptorFor } from "../../src/engine/characterFactory";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";

describe("0020 — player experience", () => {
  it("gameStatus projects week/phase/HOH/nominees/veto (Vault-free names)", () => {
    const game = new GameSessionAdapter();
    game.createCharacter({ playerName: "Player One", seed: 1 });
    game.updateCeremony({ hoh: npc(1), nominees: [npc(2), npc(3)], vetoHolder: npc(4), vetoUsed: true });
    const s = game.gameStatus();
    expect(typeof s.week).toBe("number");
    expect(s.hoh?.name).toBeTruthy();
    expect(s.nominees).toHaveLength(2);
    expect(s.veto.holder?.name).toBeTruthy();
    expect(s.veto.used).toBe(true);
    // No stat/soul fields anywhere in the projection.
    const json = JSON.stringify(s);
    for (const banned of ["physical", "mental", "social", "soul", "stats"]) expect(json.includes(banned)).toBe(false);
  });

  it("gameStatus before any game is safe and empty", () => {
    const s = new GameSessionAdapter().gameStatus();
    expect(s.hoh).toBeNull();
    expect(s.nominees).toEqual([]);
    expect(s.veto).toEqual({ holder: null, used: false, players: [] });
  });

  it("portraitDescriptorFor uses public facets only and is seed-stable", () => {
    const a = generateHouse(new SeededRandom(11)).npcs[0]!;
    const b = generateHouse(new SeededRandom(11)).npcs[0]!;
    const da = portraitDescriptorFor(a);
    expect(da.appearance.length).toBeGreaterThan(0);
    expect(typeof da.age).toBe("number");
    expect(da.vibe).toContain(a.character.archetype);
    expect(portraitDescriptorFor(b)).toEqual(da); // same seed → same portrait

    const json = JSON.stringify(da);
    for (const banned of ["physical", "mental", "stats", "soul", "volatility", "emotionalBaseline", "emotionalState"]) {
      expect(json.includes(banned)).toBe(false);
    }
  });

  it("every generated Character exposes seed-reproducible public appearance fields", () => {
    const h1 = generateHouse(new SeededRandom(3)).npcs;
    const h2 = generateHouse(new SeededRandom(3)).npcs;
    for (let i = 0; i < h1.length; i++) {
      expect(h1[i]!.character.appearance).toBe(h2[i]!.character.appearance);
      expect(h1[i]!.character.age).toBe(h2[i]!.character.age);
      expect(h1[i]!.character.presentation).toBe(h2[i]!.character.presentation);
      expect(h1[i]!.character.age).toBeGreaterThanOrEqual(21);
    }
  });
});
