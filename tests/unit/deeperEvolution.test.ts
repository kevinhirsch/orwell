import { describe, it, expect } from "vitest";
import { evolveEmotion, composedEmotion, effectiveDisposition, settleScaleOf } from "../../src/engine/emotionalArc";
import type { Soul } from "../../src/engine/characterFactory";

/**
 * Feature 0124 — deeper character evolution (the pure engine half). Three axes on 0041's soul evolution:
 * independent distress/confidence, strategic-temperament drift, and disposition-tuned reactivity. All only
 * fire under `{ soulDepth: true }`; with it off the 0041 single-scalar path is byte-identical. Roles only.
 */

const soul = (over: Partial<Soul> = {}): Soul =>
  ({ emotionalBaseline: 0.5, volatility: 0.4, emotionalState: 0.5, emotionalHistory: [], memory: [], ...over });
const DEPTH = { soulDepth: true } as const;

describe("0124 (A) — distress and confidence are independent axes", () => {
  it("a comp win then a blindside leaves BOTH confidence and distress high", () => {
    const s = soul();
    evolveEmotion(s, "comp-win", undefined, undefined, DEPTH);
    evolveEmotion(s, "blindside", undefined, undefined, DEPTH);
    expect(s.confidence!).toBeGreaterThan(0.6); // still riding the win
    expect(s.distress!).toBeGreaterThan(0.6);   // AND rattled by the blindside — at the same time
  });

  it("the distress axis drags a competition read even when confidence is high", () => {
    const confident = soul();
    evolveEmotion(confident, "comp-win", undefined, undefined, DEPTH);
    const distressed = soul();
    evolveEmotion(distressed, "comp-win", undefined, undefined, DEPTH);
    evolveEmotion(distressed, "blindside", undefined, undefined, DEPTH);
    // Same confidence, but the distressed one reads measurably worse (distress drags harder than confidence lifts).
    expect(composedEmotion(distressed)).toBeLessThan(composedEmotion(confident) - 0.2);
  });
});

describe("0124 (B) — strategic-temperament drift bends the effective disposition, not the character", () => {
  it("a neutral houseguest betrayed repeatedly hardens toward paranoia (clash)", () => {
    const s = soul();
    expect(effectiveDisposition("neutral", s)).toBe("neutral"); // starts true to baseline
    evolveEmotion(s, "betrayed", undefined, undefined, DEPTH);
    evolveEmotion(s, "betrayed", undefined, undefined, DEPTH);
    expect(effectiveDisposition("neutral", s)).toBe("clash"); // hardened
  });

  it("a calm stretch reverts the temperament toward the true baseline", () => {
    const s = soul();
    for (let i = 0; i < 3; i++) evolveEmotion(s, "betrayed", undefined, undefined, DEPTH);
    expect(effectiveDisposition("neutral", s)).toBe("clash");
    for (let i = 0; i < 8; i++) evolveEmotion(s, "calm", undefined, undefined, DEPTH);
    expect(effectiveDisposition("neutral", s)).toBe("neutral"); // settled back to who they are
  });

  it("the static disposition passed in is never mutated (CHARACTER byte-stable)", () => {
    const s = soul();
    for (let i = 0; i < 3; i++) evolveEmotion(s, "betrayed", undefined, undefined, DEPTH);
    // effectiveDisposition is a pure READ — a bond baseline still reads bond-or-neutral, never forced clash.
    expect(["bond", "neutral"]).toContain(effectiveDisposition("bond", s));
  });
});

describe("0124 (C) — disposition-tuned reactivity", () => {
  it("a more volatile (temperamental) soul swings harder on the same shock", () => {
    const clash = soul({ volatility: 0.7 }); // clash starts volatile (VOL_OF.clash)
    const bond = soul({ volatility: 0.3 });  // bond starts even-keeled (VOL_OF.bond)
    evolveEmotion(clash, "blindside");
    evolveEmotion(bond, "blindside");
    const clashSwing = Math.abs(clash.emotionalState - 0.5);
    const bondSwing = Math.abs(bond.emotionalState - 0.5);
    expect(clashSwing).toBeGreaterThan(bondSwing); // the temperamental one is more sensitive
  });

  it("a clash soul settles SLOWER than a bond soul over a calm stretch", () => {
    const clash = soul({ volatility: 0.9, settleScale: settleScaleOf("clash") });
    const bond = soul({ volatility: 0.9, settleScale: settleScaleOf("bond") });
    // settleScale only applies under the soul-depth gate (else byte-identical to 0041), so pass DEPTH.
    for (let i = 0; i < 4; i++) { evolveEmotion(clash, "calm", undefined, undefined, DEPTH); evolveEmotion(bond, "calm", undefined, undefined, DEPTH); }
    expect(clash.volatility).toBeGreaterThan(bond.volatility); // agitation lingers on the temperamental one
  });

  it("settleScaleOf reflects the disposition (clash lingers < neutral < bond shrugs off)", () => {
    expect(settleScaleOf("clash")).toBeLessThan(settleScaleOf("neutral"));
    expect(settleScaleOf("neutral")).toBeLessThan(settleScaleOf("bond"));
  });
});

describe("0124 — with soul-depth OFF, evolution is byte-identical to 0041", () => {
  it("the new axes/drift stay absent and emotionalState evolves exactly as before", () => {
    const off = soul();
    const base = soul();
    for (const e of ["blindside", "betrayed", "calm", "comp-win"] as const) {
      evolveEmotion(off, e);                                   // no soulDepth opt
      evolveEmotion(base, e, undefined, undefined, { soulDepth: false });
    }
    // No new fields populated, and the two off-paths are identical.
    expect(off.distress).toBeUndefined();
    expect(off.confidence).toBeUndefined();
    expect(off.temperamentDrift).toBeUndefined();
    expect(off.emotionalState).toBe(base.emotionalState);
    expect(off.emotionalHistory).toEqual(base.emotionalHistory);
    // composedEmotion falls back to the plain scalar when the axes are absent.
    expect(composedEmotion(off)).toBe(off.emotionalState);
    // effectiveDisposition with no drift returns the baseline unchanged.
    expect(effectiveDisposition("bond", off)).toBe("bond");
  });

  it("a PERSISTED settleScale is ignored when the flag is off (byte-identical across a flag flip)", () => {
    // A soul created flag-ON carries a disposition-tuned settleScale; evolved later flag-OFF it must settle
    // exactly like a plain 0041 soul — the default-off contract holds even across a flag flip (Greptile P1).
    const withScale = soul({ volatility: 0.9, settleScale: settleScaleOf("clash") });
    const plain = soul({ volatility: 0.9 });
    for (let i = 0; i < 4; i++) { evolveEmotion(withScale, "calm"); evolveEmotion(plain, "calm"); }
    expect(withScale.volatility).toBe(plain.volatility);
  });
});
