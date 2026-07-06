import { describe, it, expect } from "vitest";
import { isMateriallyDistorted, GOSSIP_CONSEQUENCE } from "../../src/engine/beliefReliability";

/**
 * Feature 0094 — the PURE belief-reliability classifier. Reads ONLY the existing `distortion`/
 * `confidence` fields the gossip belief model (`src/engine/gossip.ts`) already tracks on every
 * `KnowledgeFact` — no new belief store, no new field. Gates on BOTH high distortion AND low
 * confidence, so a one-hop, intact, high-confidence rumor never misfires. Roles only.
 */

describe("0094 isMateriallyDistorted — gates on BOTH distortion and confidence", () => {
  it("a witnessed fact (no distortion/confidence recorded) is never distorted", () => {
    expect(isMateriallyDistorted({})).toBe(false);
  });

  it("a one-hop, intact, high-confidence rumor is faithful — never misfires", () => {
    expect(isMateriallyDistorted({ distortion: 1.2, confidence: 0.7 })).toBe(false);
  });

  it("high distortion ALONE (confidence still high) is not enough", () => {
    expect(isMateriallyDistorted({ distortion: 3, confidence: 0.9 })).toBe(false);
  });

  it("low confidence ALONE (distortion still low) is not enough", () => {
    expect(isMateriallyDistorted({ distortion: 0.5, confidence: 0.2 })).toBe(false);
  });

  it("a genuinely many-hops, low-confidence belief IS materially distorted", () => {
    expect(isMateriallyDistorted({ distortion: 2.5, confidence: 0.4 })).toBe(true);
  });

  it("sits exactly on the boundary at the floor/ceiling (inclusive)", () => {
    expect(isMateriallyDistorted({
      distortion: GOSSIP_CONSEQUENCE.distortionFloor,
      confidence: GOSSIP_CONSEQUENCE.confidenceCeiling,
    })).toBe(true);
  });

  it("is deterministic — the same belief always classifies the same way", () => {
    const belief = { distortion: 2.8, confidence: 0.3 };
    expect(isMateriallyDistorted(belief)).toBe(isMateriallyDistorted(belief));
  });
});
