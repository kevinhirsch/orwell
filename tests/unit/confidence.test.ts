import { describe, it, expect } from "vitest";
import {
  disclosureMotive, strategicMotive, disclosureTier, decideConfidence, discloseTrue, fabricate,
  type ConfidenceSignals,
} from "../../src/engine/confidence";
import { CONFIDENCE } from "../../src/engine/confidenceConstants";
import type { HiddenElement } from "../../src/engine/characterFactory";
import type { RandomnessSource } from "../../src/ports/RandomnessSource";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * Feature 0075 — trust-gated confidences (the PURE decision core). Roles only — no names, no fixed cast.
 * The Vault Wall is structural: the engine decides the tier + truth and only `full` ever returns the real
 * premise; a lie is engine-authored from the public archetype and carries NO real secret of anyone.
 */

// A controllable rng for the seeded lie gate (next() drives the lieProb roll; int() drives fabricate picks).
const rngOf = (next: number): RandomnessSource => ({
  next: () => next,
  int: (n: number) => Math.floor(next * n),
  pick: <T>(xs: readonly T[]): T => xs[Math.floor(next * xs.length)]!,
  fork: () => rngOf(next),
});

const warm = (over: Partial<ConfidenceSignals> = {}): ConfidenceSignals => ({
  npcTrust: 0.95, npcAffinity: 0.95, npcThreat: 0, playerTrust: 0.95, playerAffinity: 0.95,
  goodwill: 0.9, archetype: "loyalist", ...over,
});
const secret: HiddenElement = { kind: "secret-motive", detail: "I came in owing my brother $4,000 and the prize is the only way I clear it" };

describe("disclosureMotive — the reason gates depth (rising bond/goodwill ⇒ a higher tier)", () => {
  it("a stranger discloses nothing; an earned ally discloses fully — monotonically", () => {
    const stranger = warm({ npcTrust: 0.2, npcAffinity: 0.2, playerTrust: 0.2, playerAffinity: 0.2, goodwill: 0 });
    expect(disclosureTier(disclosureMotive(stranger))).toBe("none");
    // sweep goodwill up from a warm-ish base: the tier never goes backwards and reaches `full`
    const tiers = [0, 0.25, 0.5, 0.75, 1].map((g) =>
      disclosureTier(disclosureMotive(warm({ npcTrust: 0.7, npcAffinity: 0.7, playerTrust: 0.7, playerAffinity: 0.7, goodwill: g }))),
    );
    const rank = { none: 0, tease: 1, partial: 2, full: 3 } as const;
    for (let i = 1; i < tiers.length; i++) expect(rank[tiers[i]!]).toBeGreaterThanOrEqual(rank[tiers[i - 1]!]);
    expect(disclosureTier(disclosureMotive(warm()))).toBe("full"); // a close ally with banked goodwill ⇒ full
  });

  it("below the `tease` band, decideConfidence returns { disclosed: false }", () => {
    const cool = warm({ npcTrust: 0.3, npcAffinity: 0.3, playerTrust: 0.3, playerAffinity: 0.3, goodwill: 0.1 });
    const d = decideConfidence(cool, new SeededRandom(1), { liesRemaining: 2 });
    expect(d.disclosed).toBe(false);
    expect(d.tier).toBe("none");
  });
});

describe("discloseTrue — only `full` crosses the whole secret (Vault Wall by tier)", () => {
  it("full = verbatim; partial drops the sharpest specifics; tease carries NO real detail", () => {
    expect(discloseTrue(secret, "full")).toBe(secret.detail);

    const partial = discloseTrue(secret, "partial");
    expect(partial).not.toBe(secret.detail);
    expect(partial).not.toMatch(/\d/);              // numbers blurred
    expect(partial.length).toBeLessThan(secret.detail.length);
    expect(secret.detail).toContain(partial.split(" ")[0]!); // still grounded in the real secret's opening

    const tease = discloseTrue(secret, "tease");
    expect(tease).toBe(CONFIDENCE.teaseGloss["secret-motive"]);
    expect(tease).not.toContain("4,000");           // the premise never crosses at tease
    expect(tease).not.toContain("brother");
  });
});

describe("lies (owner steer #3) — strategic, capped, and never a real leak", () => {
  it("only a manipulative archetype reading the player as a threat fabricates", () => {
    const manipulative = warm({ archetype: "villain", npcThreat: 0.9, npcAffinity: 0.1, npcTrust: 0.1 });
    expect(strategicMotive(manipulative)).toBeGreaterThan(0);
    expect(strategicMotive(warm({ archetype: "loyalist", npcThreat: 0.9 }))).toBe(0); // non-manipulative ⇒ never
    expect(strategicMotive(warm({ archetype: "villain", npcThreat: 0 }))).toBe(0);    // no threat read ⇒ never
  });

  it("a lie fires for a manipulator (seeded), but only with budget — and the text is never a real secret", () => {
    const liar = warm({ archetype: "mastermind", npcThreat: 0.95, npcAffinity: 0.05, npcTrust: 0.05, playerTrust: 0.3, playerAffinity: 0.3, goodwill: 0 });
    const fires = decideConfidence(liar, rngOf(0.0), { liesRemaining: 2 });  // roll < lieProb ⇒ lie
    expect(fires.disclosed).toBe(true);
    expect(fires.truthful).toBe(false);
    const denied = decideConfidence(liar, rngOf(0.99), { liesRemaining: 2 }); // roll ≥ lieProb ⇒ falls back to truth
    expect(denied.truthful).toBe(true);
    const noBudget = decideConfidence(liar, rngOf(0.0), { liesRemaining: 0 }); // cap spent ⇒ no lie
    expect(noBudget.truthful).toBe(true);

    // the fabricated text is from the public pool — never the holder's (or anyone's) real sealed detail
    const everyReal = new Set([secret.detail]);
    for (let seed = 0; seed < 50; seed++) {
      const lie = fabricate(new SeededRandom(seed), "secret-motive");
      expect(everyReal.has(lie)).toBe(false);
      const allFabs = Object.values(CONFIDENCE.fabrications).flat();
      expect(allFabs).toContain(lie);
    }
  });
});

describe("determinism + anti-sycophancy", () => {
  it("same signals + same seed ⇒ same decision", () => {
    const s = warm({ archetype: "flirt", npcThreat: 0.9, npcAffinity: 0.1, npcTrust: 0.1, goodwill: 0 });
    const a = decideConfidence(s, new SeededRandom(7), { liesRemaining: 2 });
    const b = decideConfidence(s, new SeededRandom(7), { liesRemaining: 2 });
    expect(a).toEqual(b);
  });

  it("the motive is bounded — a low-reason houseguest never yields a free full secret", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = new SeededRandom(seed);
      const s = warm({
        npcTrust: rng.next() * 0.5, npcAffinity: rng.next() * 0.5,
        playerTrust: rng.next() * 0.5, playerAffinity: rng.next() * 0.5, goodwill: rng.next() * 0.3,
        archetype: "loyalist",
      });
      expect(disclosureTier(disclosureMotive(s))).not.toBe("full"); // low reason can never reach the full tier
    }
  });
});
