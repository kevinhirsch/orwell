import { describe, it, expect } from "vitest";
import { natureFoldImpact, FRIENDLY_NATURES, RELATIONSHIP_CONSTANTS } from "../../src/engine/relationshipConstants";
import { RelationshipModel } from "../../src/engine/relationships";
import type { InteractionType } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";

/**
 * Feature 0078 Phase 2 — nature clarity. Being co-present yields an off-screen scene, but NOT every
 * scene is game talk: the NATURE follows the pair's motivation, and a FRIENDLY nature (bonding /
 * showmance — ordinary downtime warmth) folds AFFINITY ONLY (the bond warms, no strategic trust / threat
 * / alignment, no vote-affecting change), while a GAME nature folds its full strategic impact exactly as
 * before (the calibration spine). Both folds take the same four jitter draws, so swapping in the friendly
 * fold is draw-count-stable — only the friendly magnitudes shift, re-verified by the calibration sims.
 */

const GAME_NATURES: InteractionType[] = ["alliance", "strategy", "conflict", "betrayal", "gossip"];

describe("0078 Phase 2 — friendly folds affinity-only, game folds the strategic weights", () => {
  it("a FRIENDLY nature folds AFFINITY ONLY — no strategic trust / threat / alignment", () => {
    expect([...FRIENDLY_NATURES].sort()).toEqual(["bonding", "showmance"]);
    for (const t of FRIENDLY_NATURES) {
      const fold = natureFoldImpact(t);
      expect(Object.keys(fold)).toEqual(["affinity"]);                          // affinity is the ONLY signal
      expect(fold.affinity).toBe(RELATIONSHIP_CONSTANTS.IMPACT[t].affinity);    // the warmth itself is preserved
      expect(fold.trust).toBeUndefined();
      expect(fold.threat).toBeUndefined();
      expect(fold.alignment).toBeUndefined();
    }
  });

  it("a GAME nature folds its FULL strategic impact — byte-identical to pre-0078 (the calibration spine)", () => {
    for (const t of GAME_NATURES) {
      // Same object reference ⇒ the game fold is utterly unchanged.
      expect(natureFoldImpact(t)).toBe(RELATIONSHIP_CONSTANTS.IMPACT[t]);
    }
  });

  it("folding a friendly scene RAISES affinity but moves NO strategic weight; a game scene moves trust", () => {
    const a = npc(1), b = npc(2);
    // Friendly (bonding): affinity up, trust/threat/alignment untouched.
    const rf = new RelationshipModel(0.5);
    const before = { ...rf.edge(a, b) };
    rf.applyImpactDirected(a, b, natureFoldImpact("bonding"), new SeededRandom(1));
    const after = rf.edge(a, b);
    expect(after.affinity).toBeGreaterThan(before.affinity);  // the bond warms
    expect(after.trust).toBe(before.trust);                   // …with NO strategic move
    expect(after.threat).toBe(before.threat);
    expect(after.alignment).toBe(before.alignment);
    // Game (alliance): trust DOES move — it feeds the vote math.
    const rg = new RelationshipModel(0.5);
    const t0 = rg.edge(a, b).trust;
    rg.applyImpactDirected(a, b, natureFoldImpact("alliance"), new SeededRandom(1));
    expect(rg.edge(a, b).trust).toBeGreaterThan(t0);
  });

  it("the friendly fold takes the SAME rng draws as a game fold (draw-count-stable — the calibration spine stays in phase)", () => {
    function draws(impact: ReturnType<typeof natureFoldImpact>): number {
      let count = 0;
      const base = new SeededRandom(7);
      const rng = {
        next: () => { count++; return base.next(); },
        int: (n: number) => base.int(n),
        pick: <T,>(xs: readonly T[]) => base.pick(xs),
        fork: (l: string) => base.fork(l),
      };
      new RelationshipModel(0.5).applyImpactDirected(npc(1), npc(2), impact, rng);
      return count;
    }
    // Four jitter draws either way (`applyOneDirection`), so the friendly fold never re-phases the stream.
    expect(draws(natureFoldImpact("bonding"))).toBe(draws(natureFoldImpact("alliance")));
    expect(draws(natureFoldImpact("showmance"))).toBe(draws(natureFoldImpact("conflict")));
  });
});
