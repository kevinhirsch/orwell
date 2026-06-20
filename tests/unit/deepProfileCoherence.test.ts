import { describe, it, expect } from "vitest";
import { GameSessionRegistry } from "../../src/composition/registry";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import {
  generateCastDeepLayer, generateDeepProfile,
} from "../../src/engine/deepProfile";
import type { DeepProfileCharacter } from "../../src/engine/deepProfile";
import { generateHouse } from "../../src/engine/characterFactory";

/**
 * P1 — NPC story coherence. The owner's defect: the hidden secrets/true-goals/weakness were drawn from
 * FLAT SHARED pools — generic, repeated across the cast, and incoherent with the houseguest's actual
 * backstory/occupation/archetype/age. The fix conditions the seeded floor on the INDIVIDUAL Character:
 * a private chef's secret reads like a private chef's. This file is the permanent regression gate.
 *
 * Roles only — no real names; characters are constructed by FACET (archetype/vocation/age), never named.
 */

function facets(archetype: DeepProfileCharacter["archetype"], vocation: string, age: number): DeepProfileCharacter {
  return { archetype, vocation, age };
}

// One stable side-rng seed per profile so the "same character ⇒ same material" claim is exact.
function profileFor(c: DeepProfileCharacter, seed = 7) {
  return generateDeepProfile(new SeededRandom(seed), undefined, c);
}

describe("P1 — the hidden profile is DERIVED from the individual character", () => {
  it("the secrets/goals/weakness name the houseguest's own concrete vocation", () => {
    const chef = profileFor(facets("villain", "pastry chef", 34));
    const blob = [...chef.secrets, ...chef.trueGoals, chef.weakness].join(" ");
    // the houseguest's actual occupation appears in the grounded hidden material
    expect(blob).toContain("pastry chef");
  });

  it("the SAME character traits drive the SAME hidden material (deterministic, character-keyed)", () => {
    const a = profileFor(facets("mastermind", "software engineer", 29), 11);
    const b = profileFor(facets("mastermind", "software engineer", 29), 11);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("DISTINCT vocations under the same archetype/age yield DISTINGUISHABLE secret spaces", () => {
    // same archetype + age + seed, different job ⇒ the grounded material must differ (job-shaped, not generic)
    const firefighter = profileFor(facets("comp-beast", "firefighter", 30), 5);
    const nurse = profileFor(facets("comp-beast", "ER nurse", 30), 5);
    expect(firefighter.secrets.join("|")).not.toBe(nurse.secrets.join("|"));
    expect(firefighter.secrets.join(" ")).toContain("firefighter");
    expect(nurse.secrets.join(" ")).toContain("ER nurse");
  });

  it("DISTINCT archetypes under the same vocation/age yield DISTINGUISHABLE hidden material", () => {
    // same job + age + seed, different archetype ⇒ the strategic frame + weakness must differ
    const loyalist = profileFor(facets("loyalist", "bartender", 31), 9);
    const villain = profileFor(facets("villain", "bartender", 31), 9);
    expect(loyalist.weakness).not.toBe(villain.weakness);
    expect(loyalist.trueGoals.join("|")).not.toBe(villain.trueGoals.join("|"));
  });

  it("the conditioned profile still carries 2–3 distinct secrets, 2 goals, a weakness, a Day-1 read", () => {
    const p = profileFor(facets("analyst", "data analyst", 38), 3);
    expect(p.secrets.length).toBeGreaterThanOrEqual(2);
    expect(p.secrets.length).toBeLessThanOrEqual(3);
    expect(new Set(p.secrets).size).toBe(p.secrets.length); // distinct within the profile
    expect(p.trueGoals.length).toBe(2);
    expect(new Set(p.trueGoals).size).toBe(p.trueGoals.length);
    expect(p.weakness.length).toBeGreaterThan(0);
    expect(p.dayOnePerception.read.length).toBeGreaterThan(0);
  });

  it("no public-leak vocabulary in the AUTHORED text fields (no stat-key substring; no bare float)", () => {
    // NB: the hidden DeepProfile legitimately carries the signed Day-1 leans (floats) — those are
    // engine-only and never projected. We scan only the text the threads serialize (secrets/goals/weakness).
    for (const arch of ["comp-beast", "mastermind", "villain", "peacemaker"] as const) {
      const p = profileFor(facets(arch, "graphic designer", 27), 2);
      const text = [...p.secrets, ...p.trueGoals, p.weakness, p.dayOnePerception.read].join(" ");
      expect(text).not.toMatch(/"physical":|"mental":|"social":/);
      expect(text).not.toMatch(/\d+\.\d+/);
    }
  });

  it("an unknown vocation (pre-L28 save) falls back cleanly to the shared-pool floor (no throw, complete profile)", () => {
    const legacy = generateDeepProfile(new SeededRandom(4), undefined, { archetype: "floater", age: 33 } as DeepProfileCharacter);
    expect(legacy.secrets.length).toBeGreaterThanOrEqual(2);
    expect(legacy.weakness.length).toBeGreaterThan(0);
  });
});

describe("P1 — across a full 15-cast there is NO verbatim premise shared by two NPCs", () => {
  it("no two houseguests share a verbatim secret / true goal / weakness (over many seeds)", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const npcs = generateHouse(new SeededRandom(seed)).npcs;
      const layer = generateCastDeepLayer(seed, npcs);
      const secretCount = new Map<string, number>();
      const goalCount = new Map<string, number>();
      const weakCount = new Map<string, number>();
      for (const id of Object.keys(layer.hidden)) {
        const p = layer.hidden[id]!;
        for (const s of p.secrets) secretCount.set(s, (secretCount.get(s) ?? 0) + 1);
        for (const g of p.trueGoals) goalCount.set(g, (goalCount.get(g) ?? 0) + 1);
        weakCount.set(p.weakness, (weakCount.get(p.weakness) ?? 0) + 1);
      }
      // The coherence fix: character-conditioned material does not repeat verbatim across the cast.
      expect(Math.max(...secretCount.values())).toBe(1);
      expect(Math.max(...weakCount.values())).toBe(1);
      expect(Math.max(...goalCount.values())).toBe(1);
      // and the hidden layer is genuinely varied — a large distinct-secret count across the 15-cast
      expect(secretCount.size).toBeGreaterThanOrEqual(npcs.length); // ≥ one distinct secret per NPC
    }
  });

  it("the cast deep layer stays deterministic per seed (same seed ⇒ byte-identical)", () => {
    const npcs = generateHouse(new SeededRandom(21)).npcs;
    const a = generateCastDeepLayer(21, npcs);
    const b = generateCastDeepLayer(21, npcs);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("P1 — anti-sycophancy: the #389 player-independence gate STILL holds", () => {
  it("the cast deep layer keys off the cast (not the player) — generateCastDeepLayer is player-free", () => {
    // generateCastDeepLayer takes only (seed, npcs); the conditioning reads only each NPC's own
    // Character. Two casts built from the SAME seed+npcs are byte-identical regardless of any player.
    const npcs = generateHouse(new SeededRandom(33)).npcs;
    expect(JSON.stringify(generateCastDeepLayer(33, npcs))).toBe(JSON.stringify(generateCastDeepLayer(33, npcs)));
  });

  it("same seed + DIFFERENT player profiles ⇒ byte-identical NPC hidden material (live)", () => {
    const build = (playerName: string) => {
      const reg = new GameSessionRegistry();
      const sb = reg.sandboxFor(`coh-${playerName}`);
      sb.session.createCharacter({ playerName, seed: 99 });
      return sb.session.snapshot().deepProfiles ?? {};
    };
    const a = build("Alpha Player");
    const b = build("A Completely Different Player");
    // the player must not perturb NPC seeding — the hidden story material is byte-identical
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
