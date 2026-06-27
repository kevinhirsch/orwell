import { describe, it, expect } from "vitest";
import {
  deriveTrajectory, decayTrajectory, tiltNatureWeights, STEADY,
  type FoldSignal, type Trajectory,
} from "../../src/engine/trajectory";
import { TRAJECTORY_CONSTANTS as TC } from "../../src/engine/trajectoryConstants";
import { RELATIONSHIP_CONSTANTS } from "../../src/engine/relationshipConstants";
import type { InteractionType } from "../../src/engine/relationships";

/**
 * Feature 0087 — the PURE trajectory substrate (acceptance criteria 1, 2, 5, 7). A directed bond carries
 * hidden MOMENTUM derived from its recent folded history; the momentum TILTS scene-nature selection toward
 * continuing the arc, BOUNDED so off-arc beats stay possible and the 0078 betrayal gate is never bypassed.
 * Pure + seeded (no rng): same history ⇒ same trajectory. Roles only; generated fixtures.
 */

// The Vault-free fold signal a scene's NATURE maps to (the SAME bond/threat magnitudes the fold applies).
function signal(type: InteractionType): FoldSignal {
  const imp = RELATIONSHIP_CONSTANTS.IMPACT[type];
  return { bondDelta: ((imp.affinity ?? 0) + (imp.trust ?? 0)) / 2, threatDelta: imp.threat ?? 0, betrayal: type === "betrayal" };
}
const warm: FoldSignal = signal("bonding");
const clash: FoldSignal = signal("conflict");
const betray: FoldSignal = signal("betrayal");

// The off-screen society's nature order (RICH_TYPES). Mirrored here so the pure tilt test is self-contained.
const NATURES: InteractionType[] = ["alliance", "gossip", "conflict", "bonding", "strategy", "showmance", "betrayal"];
const idx = (t: InteractionType): number => NATURES.indexOf(t);
const flatWeights = (): number[] => NATURES.map(() => 1);

describe("0087 deriveTrajectory — phase + momentum from recent folded history", () => {
  it("a consistent run of warm scenes is WARMING (criterion 1)", () => {
    const t = deriveTrajectory([warm, warm, warm, warm], undefined);
    expect(t.phase).toBe("warming");
    expect(t.momentum).toBeGreaterThan(0);
  });

  it("a consistent warm run builds MORE momentum than a mixed, contradictory run (criterion 1)", () => {
    const consistent = deriveTrajectory([warm, warm, warm, warm], undefined);
    const mixed = deriveTrajectory([warm, clash, warm, clash], undefined);
    expect(consistent.momentum).toBeGreaterThan(mixed.momentum);
  });

  it("a run of clashes WITH threat rising is SOURING (the curdle), not plain cooling", () => {
    const t = deriveTrajectory([clash, clash, clash], undefined);
    expect(t.phase).toBe("souring"); // conflict carries threat ▲, so the threat-share clears the curdle bar
    expect(t.momentum).toBeGreaterThan(0);
  });

  it("a bond falling with LITTLE threat is cordial COOLING, not souring", () => {
    // A cooler scene that drops the bond but barely moves threat (a cordial drift-apart).
    const cool: FoldSignal = { bondDelta: -0.15, threatDelta: 0.01, betrayal: false };
    const t = deriveTrajectory([cool, cool, cool], undefined);
    expect(t.phase).toBe("cooling");
  });

  it("a betrayal injects strong SOURING momentum in one shot (criterion: the spike)", () => {
    const t = deriveTrajectory([betray], undefined);
    expect(t.phase).toBe("souring");
    expect(t.momentum).toBeGreaterThanOrEqual(TC.betrayalSpike);
  });

  it("a barely-moving run is STEADY (noise, not a direction) — no tilt", () => {
    const tiny: FoldSignal = { bondDelta: 0.01, threatDelta: 0.0, betrayal: false };
    const t = deriveTrajectory([tiny, tiny], undefined);
    expect(t.phase).toBe("steady");
  });

  it("only the recency window is read — a stale prefix cannot pin the phase (criterion 7-adjacent)", () => {
    // An old warm prefix then a fresh souring run: the window holds only the recent folds ⇒ souring wins.
    const folds = [warm, warm, warm, warm, clash, clash, clash, clash];
    const t = deriveTrajectory(folds, undefined);
    expect(t.phase).toBe("souring");
  });

  it("is DETERMINISTIC: same history + same prior ⇒ identical phase and momentum (criterion 5)", () => {
    const prior: Trajectory = { phase: "warming", momentum: 0.3 };
    const a = deriveTrajectory([warm, clash, warm], prior);
    const b = deriveTrajectory([warm, clash, warm], prior);
    expect(a).toEqual(b);
  });

  it("an empty history returns the prior (or STEADY) unchanged", () => {
    expect(deriveTrajectory([], undefined)).toEqual(STEADY);
    const prior: Trajectory = { phase: "souring", momentum: 0.7 };
    expect(deriveTrajectory([], prior)).toEqual(prior);
  });

  it("momentum is always bounded to [0,1]", () => {
    // Many betrayals can't push momentum past 1.
    const t = deriveTrajectory([betray, betray, betray, betray], { phase: "souring", momentum: 0.9 });
    expect(t.momentum).toBeLessThanOrEqual(1);
    expect(t.momentum).toBeGreaterThanOrEqual(0);
  });
});

describe("0087 decayTrajectory — an unfed arc reverts toward steady (the neglect cadence)", () => {
  it("reduces momentum each neglected tick", () => {
    const t0: Trajectory = { phase: "warming", momentum: 0.8 };
    const t1 = decayTrajectory(t0);
    expect(t1.momentum).toBeLessThan(t0.momentum);
    expect(t1.phase).toBe("warming"); // direction held while momentum remains
  });

  it("collapses to STEADY once momentum decays below the phase floor", () => {
    let t: Trajectory = { phase: "souring", momentum: TC.phaseFloor + 0.001 };
    t = decayTrajectory(t);
    expect(t).toEqual(STEADY);
  });
});

describe("0087 tiltNatureWeights — bounded continuation re-weight (criteria 1, 2)", () => {
  it("STEADY is the IDENTITY — exactly today's natureWeights (criterion 4 spine)", () => {
    const w = flatWeights();
    expect(tiltNatureWeights(NATURES, w, STEADY)).toEqual(w);
  });

  it("zero momentum is the identity regardless of phase", () => {
    const w = flatWeights();
    expect(tiltNatureWeights(NATURES, w, { phase: "souring", momentum: 0 })).toEqual(w);
  });

  it("WARMING up-weights bonding and down-weights conflict (criterion 1)", () => {
    const w = flatWeights();
    const tilted = tiltNatureWeights(NATURES, w, { phase: "warming", momentum: 1 });
    expect(tilted[idx("bonding")]!).toBeGreaterThan(w[idx("bonding")]!);
    expect(tilted[idx("conflict")]!).toBeLessThan(w[idx("conflict")]!);
  });

  it("SOURING up-weights conflict and kills warmth (criterion 1)", () => {
    const w = flatWeights();
    const tilted = tiltNatureWeights(NATURES, w, { phase: "souring", momentum: 1 });
    expect(tilted[idx("conflict")]!).toBeGreaterThan(w[idx("conflict")]!);
    expect(tilted[idx("bonding")]!).toBeLessThan(w[idx("bonding")]!);
  });

  it("the tilt is BOUNDED by the cap, so an off-arc nature keeps a NONZERO weight (criterion 2 — no railroad)", () => {
    const w = flatWeights();
    const tilted = tiltNatureWeights(NATURES, w, { phase: "souring", momentum: 1 });
    // bonding is the most-suppressed nature at full souring momentum; it must still be > 0.
    expect(tilted[idx("bonding")]!).toBeGreaterThan(0);
    // The down-weight is capped: never more than `tiltCap` of the original weight is removed.
    expect(tilted[idx("bonding")]!).toBeGreaterThanOrEqual(w[idx("bonding")]! * (1 - TC.tiltCap));
  });

  it("a nature already at ZERO stays zero — momentum cannot manufacture a gated betrayal (criterion 2 / 0078)", () => {
    const w = flatWeights();
    w[idx("betrayal")] = 0; // the 0078 gate gives an uneligible pair betrayal weight 0
    const tilted = tiltNatureWeights(NATURES, w, { phase: "souring", momentum: 1 });
    expect(tilted[idx("betrayal")]).toBe(0);
  });

  it("the tilt scales with momentum — a stronger arc bends harder", () => {
    const w = flatWeights();
    const light = tiltNatureWeights(NATURES, w, { phase: "souring", momentum: 0.3 });
    const heavy = tiltNatureWeights(NATURES, w, { phase: "souring", momentum: 0.9 });
    expect(heavy[idx("conflict")]!).toBeGreaterThan(light[idx("conflict")]!);
  });

  it("preserves array length and never returns a negative weight", () => {
    const w = [0.5, 0, 0.3, 0.9, 0.1, 0, 0];
    const tilted = tiltNatureWeights(NATURES, w, { phase: "cooling", momentum: 1 });
    expect(tilted).toHaveLength(w.length);
    for (const x of tilted) expect(x).toBeGreaterThanOrEqual(0);
  });
});
