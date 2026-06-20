import { describe, it, expect } from "vitest";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { hashSeed, generateHouse } from "../../src/engine/characterFactory";
import {
  generateCastDeepLayer,
  generateDeepProfile,
  newCastSpreadCaps,
} from "../../src/engine/deepProfile";
import type { DayOnePerception } from "../../src/engine/deepProfile";

/**
 * #392 OUTCOME-NEUTRALITY GATE — the character-conditioned hidden profiles must change the hidden
 * narrative TEXT and NOTHING about game outcomes.
 *
 * The bug: PR #392 made the secrets/goals/weakness character-conditioned, which consumes the per-NPC
 * hidden side-stream a DIFFERENT number of times than the old shared-pool draw. The ONLY hidden field
 * that feeds outcomes — `dayOnePerception` (it seeds the move-in NPC→player trust/affinity/threat edge)
 * — was drawn off that SAME side-stream AFTER the secrets/goals/weakness, so its selection (and the
 * cast-wide perception cap fill) shifted from the pre-#392 baseline. That perturbed the move-in edges and
 * thus every downstream comp/vote/jury roll, and at one seed flipped a passive player into a Final-2 jury
 * win with too few comp wins — tripping the anti-sycophancy EARNED_WINS guard in the full-20 jury band.
 *
 * The fix isolates the conditioned narrative TEXT onto its own dedicated sub-stream, and replays the
 * EXACT pre-#392 draw sequence on the outcome stream, so `dayOnePerception` (and the cap fill) are
 * BYTE-IDENTICAL to the old shared-pool floor. This file is the permanent local proxy for the full jury
 * band: it proves the outcome-relevant deep-profile field is unchanged by enabling the conditioning,
 * WITHOUT running the heavy jury/UAT/gradient sims. Roles only — no real names; NPCs are seeded.
 */

/**
 * Reconstruct the PRE-#392 BASELINE cast deep layer's perceptions: the SAME per-NPC `hidRng` keys and the
 * SAME shared cap tally as {@link generateCastDeepLayer}, but the LEGACY shared-pool path
 * (`generateDeepProfile(hidRng, caps)` with NO character) — exactly what the floor produced before the
 * coherence change. Returns the outcome-relevant Day-1 perception per NPC id.
 */
function baselinePerceptions(seed: number): Record<string, DayOnePerception> {
  const npcs = generateHouse(new SeededRandom(seed)).npcs;
  const caps = newCastSpreadCaps();
  const out: Record<string, DayOnePerception> = {};
  for (const hg of npcs) {
    // The byte-exact pre-#392 wiring: the hidden side-stream key + the shared-pool (no-character) draw.
    const hidRng = new SeededRandom(hashSeed(`${seed}:deep-hidden:${hg.name}`));
    out[hg.id] = generateDeepProfile(hidRng, caps).dayOnePerception;
  }
  return out;
}

/** The CURRENT (conditioned) cast layer's outcome-relevant Day-1 perception per NPC id. */
function conditionedPerceptions(seed: number): Record<string, DayOnePerception> {
  const npcs = generateHouse(new SeededRandom(seed)).npcs;
  const layer = generateCastDeepLayer(seed, npcs);
  const out: Record<string, DayOnePerception> = {};
  for (const id of Object.keys(layer.hidden)) out[id] = layer.hidden[id]!.dayOnePerception;
  return out;
}

describe("#392 — character-conditioned hidden profiles are OUTCOME-NEUTRAL", () => {
  // The seed slice covers the failing-band seed (14) plus a spread — enough to gate the property
  // without the heavy sims. The full jury/gradient bands re-validate on CI push.
  const SEEDS = [1, 2, 3, 5, 8, 13, 14, 21];

  it("the move-in Day-1 perception (the only outcome-relevant deep field) is byte-identical to the pre-#392 floor", () => {
    for (const seed of SEEDS) {
      // The whole game stream keys off this field via the move-in NPC→player edge — if it matches the
      // baseline for every NPC, every downstream comp/vote/jury outcome is unchanged by the conditioning.
      expect(
        JSON.stringify(conditionedPerceptions(seed)),
        `seed ${seed}: conditioned Day-1 perceptions must equal the pre-#392 shared-pool floor`,
      ).toBe(JSON.stringify(baselinePerceptions(seed)));
    }
  });

  it("the conditioning DID change the hidden narrative text (the #392 win is real), only not the outcome field", () => {
    // Sanity: prove the test isn't vacuous — the secrets/goals/weakness DID change vs the legacy floor,
    // so we are genuinely asserting neutrality of an outcome field while the narrative text moved.
    const seed = 14;
    const npcs = generateHouse(new SeededRandom(seed)).npcs;
    const layer = generateCastDeepLayer(seed, npcs);
    const caps = newCastSpreadCaps();
    let anyTextDiffered = false;
    for (const hg of npcs) {
      const hidRng = new SeededRandom(hashSeed(`${seed}:deep-hidden:${hg.name}`));
      const legacy = generateDeepProfile(hidRng, caps);
      const conditioned = layer.hidden[hg.id]!;
      if (JSON.stringify(conditioned.secrets) !== JSON.stringify(legacy.secrets)) anyTextDiffered = true;
    }
    expect(anyTextDiffered, "the conditioned secrets must differ from the legacy shared-pool secrets").toBe(true);
  });

  it("the perception cap (cast-wide spread) is honored identically — no read appears more than MAX_PER_PERCEPTION", () => {
    for (const seed of SEEDS) {
      const perc = conditionedPerceptions(seed);
      const reads = new Map<string, number>();
      for (const id of Object.keys(perc)) reads.set(perc[id]!.read, (reads.get(perc[id]!.read) ?? 0) + 1);
      // The cap is part of the byte-identical baseline above; this is the direct spread assertion.
      expect(Math.max(...reads.values()), `seed ${seed}: perception spread cap respected`).toBeLessThanOrEqual(3);
    }
  });
});
