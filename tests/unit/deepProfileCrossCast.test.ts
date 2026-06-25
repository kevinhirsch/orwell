import { describe, it, expect } from "vitest";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { generateHouse } from "../../src/engine/characterFactory";
import {
  generateCastDeepLayer,
  generateDeepProfile,
  newCastSpreadCaps,
} from "../../src/engine/deepProfile";
import type { DeepProfileCharacter } from "../../src/engine/deepProfile";

/**
 * #850 — cross-cast de-collision on the CONDITIONED deep-profile path. Before this fix the cast-wide
 * spread caps were wired only to the dead legacy shared-pool path; the conditioned path deduped a
 * houseguest's secrets/goals/weakness only WITHIN one profile, so two houseguests could (rarely) compose
 * a verbatim-identical secret/goal/weakness. The fix tracks the composed text cast-wide and resolves a
 * collision DETERMINISTICALLY — by rotating the component indices with NO further rng draw (the #853
 * surname-dedup discipline), entirely on the ISOLATED narrative stream — so a non-colliding cast is
 * byte-identical to before and the #338 golden outcome stream is untouched.
 *
 * Roles only — characters are built by FACET (archetype/vocation/age), never named.
 */

function facets(archetype: DeepProfileCharacter["archetype"], vocation: string, age: number): DeepProfileCharacter {
  return { archetype, vocation, age };
}

describe("#850 — a forced collision is de-collided deterministically (no rng), staying coherent", () => {
  // Two houseguests with the SAME narrative seed + SAME character + a SHARED caps object. Without a
  // cross-cast cap the second profile would be VERBATIM-IDENTICAL to the first (same narrativeRng ⇒ same
  // base picks). The cap must force the second to a distinct — but still character-coherent — set.
  function pair(c: DeepProfileCharacter, narrativeSeed = 4242) {
    const caps = newCastSpreadCaps();
    const a = generateDeepProfile(new SeededRandom(100), caps, c, narrativeSeed);
    const b = generateDeepProfile(new SeededRandom(100), caps, c, narrativeSeed); // same seed ⇒ would collide
    return { a, b };
  }

  it("the two profiles share NO verbatim secret / goal / weakness", () => {
    const { a, b } = pair(facets("villain", "pastry chef", 34));
    const allSecrets = [...a.secrets, ...b.secrets];
    const allGoals = [...a.trueGoals, ...b.trueGoals];
    expect(new Set(allSecrets).size, "secrets unique across both").toBe(allSecrets.length);
    expect(new Set(allGoals).size, "goals unique across both").toBe(allGoals.length);
    expect(a.weakness, "weaknesses differ").not.toBe(b.weakness);
  });

  it("the de-collided profile stays coherent — same archetype frame family, same concrete vocation", () => {
    const { a, b } = pair(facets("villain", "pastry chef", 34));
    // The de-collision rotates a COMPONENT (stake/frame/tell), never the vocation grounding — so the
    // job still reads through in every field of the resolved profile.
    for (const s of b.secrets) expect(s).toContain("pastry chef");
    for (const g of b.trueGoals) expect(g).toContain("pastry chef");
    expect(b.weakness).toContain("pastry chef");
    // No public-leak vocabulary survives the rotation.
    const blob = [...b.secrets, ...b.trueGoals, b.weakness].join(" ");
    expect(blob).not.toMatch(/"physical":|"mental":|"social":/);
    expect(blob).not.toMatch(/\d+\.\d+/);
  });

  it("de-collision is itself DETERMINISTIC (same inputs ⇒ same resolved pair)", () => {
    const first = pair(facets("mastermind", "software engineer", 29));
    const second = pair(facets("mastermind", "software engineer", 29));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe("#850 — across full casts the conditioned text is cast-wide unique (the real path, many seeds)", () => {
  it("no two houseguests share a verbatim secret / goal / weakness (wide seed sweep)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const npcs = generateHouse(new SeededRandom(seed)).npcs;
      const layer = generateCastDeepLayer(seed, npcs);
      const secrets = new Map<string, number>();
      const goals = new Map<string, number>();
      const weaknesses = new Map<string, number>();
      for (const id of Object.keys(layer.hidden)) {
        const p = layer.hidden[id]!;
        for (const s of p.secrets) secrets.set(s, (secrets.get(s) ?? 0) + 1);
        for (const g of p.trueGoals) goals.set(g, (goals.get(g) ?? 0) + 1);
        weaknesses.set(p.weakness, (weaknesses.get(p.weakness) ?? 0) + 1);
      }
      expect(Math.max(...secrets.values()), `seed ${seed} secret`).toBe(1);
      expect(Math.max(...goals.values()), `seed ${seed} goal`).toBe(1);
      expect(Math.max(...weaknesses.values()), `seed ${seed} weakness`).toBe(1);
    }
  });

  it("the cast deep layer stays deterministic per seed (de-collision included)", () => {
    const npcs = generateHouse(new SeededRandom(77)).npcs;
    expect(JSON.stringify(generateCastDeepLayer(77, npcs))).toBe(JSON.stringify(generateCastDeepLayer(77, npcs)));
  });
});

describe("#850 — RNG isolation: the cross-cast cap rides the narrative stream only", () => {
  it("the OUTCOME-relevant dayOnePerception is UNCHANGED whether or not narrative caps are present", () => {
    // The conditioned path draws dayOnePerception off the OUTCOME `rng`, independent of the narrative
    // de-collision. Same outcome rng + same perception caps ⇒ identical perception, regardless of the
    // narrative text path — proving the cross-cast narrative cap never touches the outcome stream.
    const c = facets("comp-beast", "firefighter", 30);
    const capsA = newCastSpreadCaps();
    const capsB = newCastSpreadCaps();
    const pa = generateDeepProfile(new SeededRandom(55), capsA, c, 1);
    const pb = generateDeepProfile(new SeededRandom(55), capsB, c, 999); // different NARRATIVE seed only
    // Different narrative seed ⇒ (likely) different text, but the perception is drawn off the SAME outcome
    // rng with the SAME perception-cap state ⇒ byte-identical.
    expect(pb.dayOnePerception).toEqual(pa.dayOnePerception);
  });
});
