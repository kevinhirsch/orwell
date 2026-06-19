import { describe, it, expect } from "vitest";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import {
  generateHouse,
  generateBackstoryFacets,
  MAX_PER_VOCATION,
  MAX_PER_REGION,
} from "../../src/engine/characterFactory";
import { VOCATIONS } from "../../src/engine/data/vocations";
import { HOMETOWNS, HOMETOWN_REGIONS } from "../../src/engine/data/hometowns";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

/**
 * L28 — grounded realism: the NPC cast is a producer-filtered, DIVERSE crew that NEVER mirrors the
 * player, and each NPC carries a CONCRETE backstory (vocation + hometown) that PERSISTS airtight.
 *
 * HARD rule (repo testing rules): roles only — no fixture names ingested as canonical data. We assert
 * SHAPE and DIVERSITY, never which name maps to which job.
 */

const regionOf = (city: string): string =>
  HOMETOWNS.find((h) => h.city === city)?.region ?? "?";

const tally = <T>(xs: readonly T[]): Map<T, number> => {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
};

describe("L28/A — the corpora are large, varied raw material", () => {
  it("vocations span a big pool with no duplicate entries", () => {
    expect(VOCATIONS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(VOCATIONS).size).toBe(VOCATIONS.length);
  });

  it("hometowns span every region and a big pool", () => {
    expect(HOMETOWNS.length).toBeGreaterThanOrEqual(100);
    // a real cast comes from all over: multiple distinct regions are represented
    expect(HOMETOWN_REGIONS.length).toBeGreaterThanOrEqual(4);
  });

  it("no facet smuggles hidden-layer vocabulary (Vault-free public facets)", () => {
    for (const v of VOCATIONS) {
      expect(v).not.toMatch(/\b(trust|affinity|threat|soul|confessional|secret-motive|stat)\b/i);
    }
    for (const h of HOMETOWNS) {
      expect(h.city).not.toMatch(/\b(trust|affinity|threat|soul|confessional|secret-motive|stat)\b/i);
    }
  });
});

describe("L28/B — the cast carries concrete, DIVERSE backstories", () => {
  it("every NPC has a concrete vocation and hometown drawn from the corpora", () => {
    const { npcs } = generateHouse(new SeededRandom(101));
    expect(npcs.length).toBe(15);
    for (const n of npcs) {
      expect(n.character.vocation).toBeTruthy();
      expect(n.character.hometown).toBeTruthy();
      expect(VOCATIONS).toContain(n.character.vocation);
      expect(HOMETOWNS.map((h) => h.city)).toContain(n.character.hometown);
    }
  });

  it("vocations are VARIED and no single vocation dominates the house", () => {
    // sweep several seeds: the diversity must hold across casts, not just one lucky draw
    for (const seed of [3, 17, 88, 256, 1009, 4242]) {
      const { npcs } = generateHouse(new SeededRandom(seed));
      const vocations = npcs.map((n) => n.character.vocation!);
      // real variety: well over half the cast holds a distinct job
      expect(new Set(vocations).size).toBeGreaterThanOrEqual(10);
      // the cap holds: no vocation piles up implausibly
      for (const [, count] of tally(vocations)) {
        expect(count).toBeLessThanOrEqual(MAX_PER_VOCATION);
      }
    }
  });

  it("hometowns spread across regions — no one region accents the whole house", () => {
    for (const seed of [3, 17, 88, 256, 1009, 4242]) {
      const { npcs } = generateHouse(new SeededRandom(seed));
      const cities = npcs.map((n) => n.character.hometown!);
      // no exact city repeats within a house
      expect(new Set(cities).size).toBe(cities.length);
      const regions = cities.map(regionOf);
      // geography is genuinely spread: at least three distinct regions every season
      expect(new Set(regions).size).toBeGreaterThanOrEqual(3);
      // the per-region cap holds
      for (const [, count] of tally(regions)) {
        expect(count).toBeLessThanOrEqual(MAX_PER_REGION);
      }
    }
  });

  it("the spread caps are tunable constants, not magic numbers", () => {
    expect(MAX_PER_VOCATION).toBeGreaterThanOrEqual(1);
    expect(MAX_PER_REGION).toBeGreaterThanOrEqual(1);
    // a 15-cast must be satisfiable: the caps can't be so tight they can't cover everyone
    expect(MAX_PER_REGION * HOMETOWN_REGIONS.length).toBeGreaterThanOrEqual(15);
  });
});

describe("L28/C — non-mirroring & player-INDEPENDENCE", () => {
  it("the same seed deals byte-identical NPCs regardless of the player's profile", () => {
    const mirror = (name: string, job: string, town: string) => {
      const s = new GameSessionAdapter();
      const v = s.createCharacter({
        playerName: name,
        seed: 777,
        backstory: `a ${job} from ${town}`,
        personaArchetype: job,
        motivation: `to represent ${town}`,
      });
      // the 15 NPC cards, fully (every public facet incl. the new ones), as a stable string
      return v.house
        .map((h) => [h.name, h.archetype, h.strategyStyle, h.background, h.age, h.appearance, h.presentation, h.vocation, h.hometown].join("§"))
        .join("\n");
    };
    // a player whose whole identity screams Phoenix / summer-camp-director (the L28 bug report)…
    const phoenixCamp = mirror("Camp Director", "summer camp director", "Phoenix, AZ");
    // …versus a wildly different player on the SAME seed
    const londonChef = mirror("Sea Change", "commercial fisherman", "London, UK");
    expect(phoenixCamp).toBe(londonChef);
  });

  it("a player's vocation/hometown is NOT over-represented among the NPCs", () => {
    // The player claims a Phoenix summer-camp-director identity; the NPC cast must not echo it.
    const s = new GameSessionAdapter();
    const v = s.createCharacter({
      playerName: "The Player",
      seed: 4242,
      backstory: "a summer camp director from Phoenix, AZ",
      personaArchetype: "summer camp director",
    });
    const npcCities = v.house.map((h) => h.hometown!);
    const npcRegions = npcCities.map(regionOf);
    // the player's home REGION (West) can appear, but never dominate the house
    expect(npcRegions.filter((r) => r === "West").length).toBeLessThanOrEqual(MAX_PER_REGION);
    // and the player's exact hometown is not piled onto the cast
    expect(npcCities.filter((c) => c === "Phoenix, AZ").length).toBeLessThanOrEqual(1);
    // the player's vocation is never echoed (it isn't even in the NPC corpus form)
    expect(v.house.filter((h) => h.vocation === "summer camp director").length).toBe(0);
  });

  it("generateBackstoryFacets reads only its rng — same rng seed ⇒ same deal", () => {
    const deal = (seed: number) =>
      generateBackstoryFacets(new SeededRandom(seed), 15).map((f) => `${f.vocation}|${f.hometown}`).join("~");
    expect(deal(13)).toBe(deal(13));
    expect(deal(13)).not.toBe(deal(14));
  });
});

describe("L28/D — the backstory PERSISTS airtight (no regenerate, no drift)", () => {
  it("vocation + hometown survive a snapshot→restore unchanged", () => {
    const a = new GameSessionAdapter();
    a.createCharacter({ playerName: "The Player", seed: 555 });
    const before = a.getGameState().house.map((h) => `${h.name}|${h.vocation}|${h.hometown}`);

    // round-trip the durable snapshot into a fresh adapter (the restart path, 0030)
    const snap = a.snapshot();
    const b = new GameSessionAdapter();
    b.restore(snap);
    const after = b.getGameState().house.map((h) => `${h.name}|${h.vocation}|${h.hometown}`);

    expect(after).toEqual(before);
    // and nothing was lost / blanked on the way through
    for (const line of after) expect(line).not.toMatch(/\|undefined\|/);
  });

  it("a resumed game never REGENERATES the facets (byte-identical across reads & restores)", () => {
    const a = new GameSessionAdapter();
    a.createCharacter({ playerName: "The Player", seed: 99 });
    const read1 = a.getGameState().house.map((h) => `${h.vocation}|${h.hometown}`);

    // restore twice through fresh adapters; the stored baseline must be stable each time
    const round = (src: GameSessionAdapter) => {
      const next = new GameSessionAdapter();
      next.restore(src.snapshot());
      return next;
    };
    const b = round(a);
    const c = round(b);
    const read2 = b.getGameState().house.map((h) => `${h.vocation}|${h.hometown}`);
    const read3 = c.getGameState().house.map((h) => `${h.vocation}|${h.hometown}`);
    expect(read2).toEqual(read1);
    expect(read3).toEqual(read1);
  });

  it("the stored facets reach the narrator's roster voice cue", async () => {
    const { renderGameContext } = await import("../../src/engine/momentPrompts");
    const s = new GameSessionAdapter();
    const view = s.createCharacter({ playerName: "The Player", seed: 31 });
    const ctx = renderGameContext(view);
    const first = view.house[0]!;
    expect(ctx).toContain(first.vocation!);
    expect(ctx).toContain(`from ${first.hometown!}`);
  });
});
