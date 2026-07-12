import { describe, it, expect } from "vitest";
import {
  foldHiddenImpact, foldGenerativeConsequence, NO_FATIGUE, type FatigueValence,
} from "../../src/engine/consequence";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * #1419 (player-side) — the ASYMMETRIC social-fatigue fold for the PLAYER's own recorded scenes, the
 * mirror of the off-screen NPC↔NPC valence. A tired initiator's WARMING folds land softer (`warm` < 1)
 * and their SOURING folds cut deeper (`sore` > 1) — "harder to scheme when you aren't sleeping." The
 * scale is applied BEFORE the seeded jitter (`applyDirectedValence`/`scaleImpactByValence`), so the same
 * four rng draws happen either way — only the magnitudes shift. `NO_FATIGUE` ⇒ byte-identical.
 *
 * Roles only — no names; all fixtures generated. A fresh model + an identically-seeded rng per run isolates
 * the magnitude change from the jitter stream.
 */

const TIRED: FatigueValence = { warm: 0.4, sore: 1.4 }; // a full-deficit initiator (floor / cap)
const SEED = 5;

/** Fold one player-initiated `kind` scene onto an NPC and read the resulting directed edge. */
function foldKind(kind: "bonding" | "conflict", fatigue: FatigueValence) {
  const rel = new RelationshipModel(0.5);
  foldHiddenImpact(rel, new SeededRandom(SEED), PLAYER, [PLAYER, npc(1)], kind, undefined, undefined, undefined, fatigue);
  return rel.edge(npc(1), PLAYER);
}

describe("#1419 player-side — the fatigue fold is asymmetric AND byte-identical when rested", () => {
  it("NO_FATIGUE is byte-identical to omitting the valence entirely", () => {
    const withArg = foldKind("bonding", NO_FATIGUE);
    const rel = new RelationshipModel(0.5);
    foldHiddenImpact(rel, new SeededRandom(SEED), PLAYER, [PLAYER, npc(1)], "bonding"); // no valence arg
    expect(withArg).toEqual(rel.edge(npc(1), PLAYER));
  });

  it("a tired player's WARMING scene (bonding) moves the NPC's trust/affinity LESS than rested", () => {
    const rested = foldKind("bonding", NO_FATIGUE);
    const tired = foldKind("bonding", TIRED);
    // Warming folds are dampened: the tired player builds a weaker bond from the same scene.
    expect(tired.trust).toBeLessThan(rested.trust);
    expect(tired.affinity).toBeLessThan(rested.affinity);
    expect(tired.trust).toBeGreaterThan(0); // still a positive move — dampened, not erased
  });

  it("a tired player's SOURING scene (conflict) cuts DEEPER — more threat than rested", () => {
    const rested = foldKind("conflict", NO_FATIGUE);
    const tired = foldKind("conflict", TIRED);
    // Souring folds are amplified: the tired player's spat lands harder.
    expect(tired.threat).toBeGreaterThan(rested.threat);
  });

  it("the generative path is valence-scaled too (a tired warm pitch lands softer)", () => {
    const fold = (fatigue: FatigueValence) => {
      const rel = new RelationshipModel(0.5);
      foldGenerativeConsequence(
        rel, new SeededRandom(SEED), PLAYER,
        [{ toward: npc(1), direction: "more-trust", emphasis: "strong" }],
        () => true, fatigue,
      );
      return rel.edge(npc(1), PLAYER).trust;
    };
    expect(fold(TIRED)).toBeLessThan(fold(NO_FATIGUE));
    expect(fold(NO_FATIGUE)).toEqual(fold(NO_FATIGUE)); // deterministic
  });
});
