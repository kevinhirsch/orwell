import { describe, it, expect } from "vitest";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import {
  severityOf,
  leverageStrength,
  leverageDealBoost,
  dealAcceptance,
  exposeOutcome,
  tradeValue,
  tradeDealBoost,
  tradeOutcome,
  npcBarterStep,
  bluffBelieved,
  type LeverageSignals,
  type TradeSignals,
} from "../../src/engine/leverage";
import { LEVERAGE, SECRET_TRADE } from "../../src/engine/leverageConstants";

/**
 * Features 0093 + 0099 — the PURE decision core. Seeded + bounded + deterministic; the engine owns
 * every magnitude (ADR 0005), and no Vault TEXT ever informs an amount (severity reads the public KIND
 * only). Roles only — no names, all fixtures synthetic. These prove the math BEFORE the adapter wires it.
 */

const inUnit = (x: number): boolean => x >= 0 && x <= 1;

describe("0093 — severity reads the public KIND only (never sealed text)", () => {
  it("a hidden agenda / a slipped mask weigh more than a pre-game tie / a thrown comp", () => {
    expect(severityOf("secret-motive")).toBeGreaterThan(severityOf("pre-game-tie"));
    expect(severityOf("divergent-persona")).toBeGreaterThan(severityOf("concealed-aptitude"));
  });
  it("a trigger / an unknown kind reads at the bounded default (never a usable-secret weight)", () => {
    expect(severityOf("trigger")).toBe(LEVERAGE.defaultSeverity);
    expect(severityOf(undefined)).toBe(LEVERAGE.defaultSeverity);
  });
});

describe("0093 — leverageStrength is bounded, seeded, deterministic, and NEVER deterministic-yes", () => {
  const sig = (over: Partial<LeverageSignals> = {}): LeverageSignals => ({
    severity: 0.85, subjectEmotionalState: 0.3, subjectTrust: 0.3, subjectAffinity: 0.3, subjectThreat: 0.4, ...over,
  });

  it("stays within [0,1] across a wide signal sweep", () => {
    for (let i = 0; i < 50; i++) {
      const rng = new SeededRandom(i + 1);
      const s = leverageStrength(sig({ severity: i / 50, subjectEmotionalState: (i % 7) / 7 }), rng);
      expect(inUnit(s)).toBe(true);
    }
  });

  it("same signals + same seed ⇒ same strength (deterministic)", () => {
    expect(leverageStrength(sig(), new SeededRandom(7))).toBe(leverageStrength(sig(), new SeededRandom(7)));
  });

  it("a rattled, vulnerable subject yields MORE pressure than a steady, guarded one (felt, not flat)", () => {
    const rattled = leverageStrength(sig({ subjectEmotionalState: 0.05 }), new SeededRandom(3));
    const steady = leverageStrength(sig({ subjectEmotionalState: 0.95 }), new SeededRandom(3));
    expect(rattled).toBeGreaterThan(steady);
  });

  it("even a full-strength squeeze never guarantees the deal — the boost is CAPPED (recoverable ceiling)", () => {
    // The ceiling is bounded: a max-strength leverage can lift the read by at most `dealFactorCap`, never
    // to certainty. A HOSTILE subject (signed warmth strongly negative — high threat, no warmth) starts
    // well below the floor, so even a max squeeze leaves them refusing: pressure, not an "I win" button.
    expect(leverageDealBoost(1.0)).toBeLessThanOrEqual(LEVERAGE.dealFactorCap);
    const { accepts } = dealAcceptance(-0.8, leverageDealBoost(1.0), LEVERAGE.refusalFloor);
    expect(accepts).toBe(false); // the squeeze is felt but the deal is refused — a wary subject calls it
  });

  it("leverage RAISES the acceptance read vs. no leverage (it colors the deal)", () => {
    const warmth = 0.1; // a mildly-warm subject (signed)
    const without = dealAcceptance(warmth, 0, LEVERAGE.refusalFloor).read;
    const withLev = dealAcceptance(warmth, leverageDealBoost(0.8), LEVERAGE.refusalFloor).read;
    expect(withLev).toBeGreaterThan(without);
  });
});

describe("0093 — exposeOutcome is bounded, seeded, and recoverable (real but not game-ending)", () => {
  it("the subject-hit, the exposer backlash, and the house recoil are all bounded folds", () => {
    const folds = exposeOutcome(0.85, new SeededRandom(5));
    // The subject hit cools warmth + raises threat, scaled within the band — never beyond the betrayal floor.
    expect(folds.subjectHit.threat!).toBeGreaterThan(0);
    expect(folds.subjectHit.affinity!).toBeLessThan(0);
    expect(Math.abs(folds.subjectHit.threat!)).toBeLessThanOrEqual(Math.abs(LEVERAGE.exposeSubjectHit.threat!));
    // The exposer takes the betrayal-grade hit FROM the subject (the deepest wound).
    expect(folds.exposerBacklashFromSubject.trust!).toBeLessThanOrEqual(LEVERAGE.exposerBacklashFromSubject.trust!);
    expect(folds.juryMark).toBe(true);
  });

  it("deterministic for the same severity + seed; a juicier secret cuts deeper", () => {
    expect(JSON.stringify(exposeOutcome(0.8, new SeededRandom(9)))).toBe(JSON.stringify(exposeOutcome(0.8, new SeededRandom(9))));
    const sharp = Math.abs(exposeOutcome(1.0, new SeededRandom(1)).subjectHit.threat!);
    const dull = Math.abs(exposeOutcome(0.2, new SeededRandom(1)).subjectHit.threat!);
    expect(sharp).toBeGreaterThan(dull);
  });
});

describe("0099 — tradeValue is the RECIPIENT's: valued only when they want leverage on the subject", () => {
  const sig = (over: Partial<TradeSignals> = {}): TradeSignals => ({
    severity: 0.8, recipientThreatOfSubject: 0.8, recipientAffinityForSubject: 0.1, recipientTrustOfPlayer: 0.5, ...over,
  });

  it("a secret about a FEARED rival is worth far more than the same secret about a TRUSTED ally", () => {
    const aboutRival = tradeValue(sig({ recipientThreatOfSubject: 0.9, recipientAffinityForSubject: 0.05 }), new SeededRandom(2));
    const aboutAlly = tradeValue(sig({ recipientThreatOfSubject: 0.05, recipientAffinityForSubject: 0.9 }), new SeededRandom(2));
    expect(aboutRival).toBeGreaterThan(aboutAlly);
  });

  it("stays bounded + deterministic", () => {
    for (let i = 0; i < 30; i++) expect(inUnit(tradeValue(sig({ severity: i / 30 }), new SeededRandom(i + 1)))).toBe(true);
    expect(tradeValue(sig(), new SeededRandom(4))).toBe(tradeValue(sig(), new SeededRandom(4)));
  });

  it("a near-worthless secret barely moves the deal; a valued one moves it (capped, never forced)", () => {
    const ally = tradeValue(sig({ recipientThreatOfSubject: 0.0, recipientAffinityForSubject: 0.95, severity: 0.5 }), new SeededRandom(8));
    const rival = tradeValue(sig({ recipientThreatOfSubject: 0.95, recipientAffinityForSubject: 0.0, severity: 0.9 }), new SeededRandom(8));
    expect(tradeDealBoost(rival)).toBeGreaterThan(tradeDealBoost(ally));
    expect(tradeDealBoost(1.0)).toBeLessThanOrEqual(SECRET_TRADE.dealFactorCap);
  });

  it("tradeOutcome: a wanted trade closes + warms the recipient; a distrusted-source worthless trade can refuse + backlash", () => {
    const closed = tradeOutcome(0.9, 0.7, new SeededRandom(3));
    expect(closed.accepted).toBe(true);
    expect(closed.recipientFold!.affinity!).toBeGreaterThan(0);
    const refused = tradeOutcome(0.05, -0.7, new SeededRandom(3)); // a distrustful recipient, worthless secret
    expect(refused.accepted).toBe(false);
    expect(refused.traderBacklash!.trust!).toBeLessThan(0);
  });
});

describe("0099 — the off-screen barter is seeded + rate-limited (a driver, not a second engine)", () => {
  it("picks the recipient who values the fact most, gated by the seeded rate; deterministic", () => {
    const candidates = [
      { recipient: "npc:a", signals: { severity: 0.8, recipientThreatOfSubject: 0.9, recipientAffinityForSubject: 0.0, recipientTrustOfPlayer: 0.5 } },
      { recipient: "npc:b", signals: { severity: 0.8, recipientThreatOfSubject: 0.1, recipientAffinityForSubject: 0.9, recipientTrustOfPlayer: 0.5 } },
    ];
    const a = npcBarterStep(candidates, new SeededRandom(1));
    const b = npcBarterStep(candidates, new SeededRandom(1));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // seed-deterministic
    if (a) expect(a.recipient).toBe("npc:a"); // the one who wants leverage on the subject
  });

  it("no candidate clears the value floor ⇒ no barter", () => {
    const cold = [{ recipient: "npc:x", signals: { severity: 0.1, recipientThreatOfSubject: 0.0, recipientAffinityForSubject: 0.9, recipientTrustOfPlayer: 0.0 } }];
    // Try many seeds; even when the rate fires, the value floor blocks the cold candidate.
    let anyMove = false;
    for (let i = 0; i < 40; i++) if (npcBarterStep(cold, new SeededRandom(i + 1))) anyMove = true;
    expect(anyMove).toBe(false);
  });
});

describe("deception — a bluff folds on BELIEF, weighted by trust × plausibility (no Vault read)", () => {
  it("a believable claim about a feared rived from a trusted source lands; a wild claim from a distrusted source bounces", () => {
    const lands = bluffBelieved(0.9, 0.9, new SeededRandom(2));
    const bounces = bluffBelieved(0.05, 0.05, new SeededRandom(2));
    expect(lands).toBe(true);
    expect(bounces).toBe(false);
  });
  it("is deterministic for the same inputs + seed", () => {
    expect(bluffBelieved(0.6, 0.6, new SeededRandom(5))).toBe(bluffBelieved(0.6, 0.6, new SeededRandom(5)));
  });
});
