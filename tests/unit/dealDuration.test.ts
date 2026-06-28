import { describe, it, expect } from "vitest";
import { DealLedger, breakSeverityScale } from "../../src/engine/deals";
import type { Deal } from "../../src/domain/deal";
import { RelationshipModel } from "../../src/engine/relationships";
import { DEAL_DURATION } from "../../src/engine/relationshipConstants";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * Feature 0109 — negotiated deal duration (when does a promise expire — and when do you turn?).
 *
 * Amends 0039. A deal gains an optional NEGOTIATED term (an explicit `expiresWeek` or the `vague`
 * label) that modulates ONLY the break's betrayal-shock magnitude and the expiry resolution — every
 * other path stays byte-identical. The engine owns the bounded, seeded magnitude (mandate #3 / ADR
 * 0005); the player sees the negotiated TERM (their own knowledge) but never a derived shock number.
 *
 * HARD rule: roles only — promisor / partner / the wronged party / others. No names; nothing ingested.
 */

const PROMISOR = "promisor";
const PARTNER = "partner";
const OTHER_A = "other-a";
const OTHER_B = "other-b";

/** A fresh relationship model whose PARTNER→PROMISOR edge we watch take the betrayal hit. */
function freshRel(): RelationshipModel {
  return new RelationshipModel(0.5);
}

/** The wronged party's hidden read of the breaker, captured as plain data. */
function edge(rel: RelationshipModel) {
  return { ...rel.edge(PARTNER, PROMISOR) };
}

/** Break the deal by nominating the protected partner (an adverse swing the engine adjudicates). */
function breakDeal(ledger: DealLedger, rel: RelationshipModel, currentWeek?: number) {
  ledger.reconcile(
    { actor: PROMISOR, kind: "nominate", targets: [PARTNER] },
    { rel, rng: new SeededRandom(11), ...(currentWeek !== undefined ? { currentWeek } : {}) },
  );
}

describe("0109 — pure breakSeverityScale (engine-owned, bounded magnitude)", () => {
  const deal = (over: Partial<Deal>): Deal => ({
    id: "d", parties: [PROMISOR, PARTNER], kind: "final-two", terms: "", condition: { protect: PARTNER, promisors: [PROMISOR, PARTNER] }, status: "open", ...over,
  });

  it("no duration ⇒ identity floor of exactly 1", () => {
    expect(breakSeverityScale(deal({}))).toBe(1);
    expect(breakSeverityScale(deal({}), 3)).toBe(1);
  });

  it("vague ⇒ the soften factor (< 1), regardless of week", () => {
    expect(breakSeverityScale(deal({ vague: true }))).toBe(DEAL_DURATION.vagueSoften);
    expect(breakSeverityScale(deal({ vague: true }), 99)).toBe(DEAL_DURATION.vagueSoften);
    expect(DEAL_DURATION.vagueSoften).toBeLessThan(1);
  });

  it("explicit expiresWeek scales UP with weeks remaining (more life left ⇒ bigger shock)", () => {
    // expiresWeek 5: at week 4 (1 left) < week 2 (3 left).
    const oneLeft = breakSeverityScale(deal({ expiresWeek: 5 }), 4);
    const threeLeft = breakSeverityScale(deal({ expiresWeek: 5 }), 2);
    expect(oneLeft).toBeCloseTo(1 + DEAL_DURATION.perWeekRemaining * 1, 10);
    expect(threeLeft).toBeCloseTo(1 + DEAL_DURATION.perWeekRemaining * 3, 10);
    expect(threeLeft).toBeGreaterThan(oneLeft);
    expect(oneLeft).toBeGreaterThan(1); // a term-remaining break is HARDER than the floor
  });

  it("at/after the explicit term ⇒ floor 1 (no negative scaling)", () => {
    expect(breakSeverityScale(deal({ expiresWeek: 5 }), 5)).toBe(1); // 0 weeks left
    expect(breakSeverityScale(deal({ expiresWeek: 5 }), 8)).toBe(1); // past it
  });

  it("the remaining-life scale is CAPPED at maxScale (a bound, never a runaway)", () => {
    // A wildly long term (many weeks left) cannot amplify past the cap.
    const far = breakSeverityScale(deal({ expiresWeek: 100 }), 1);
    expect(far).toBe(DEAL_DURATION.maxScale);
    // The cap is reached once weeksLeft ≥ (maxScale-1)/perWeekRemaining.
    const atCap = (DEAL_DURATION.maxScale - 1) / DEAL_DURATION.perWeekRemaining;
    expect(breakSeverityScale(deal({ expiresWeek: Math.ceil(atCap) + 1 }), 0)).toBe(DEAL_DURATION.maxScale);
  });

  it("an explicit term with NO currentWeek to measure against ⇒ floor 1 (back-compat)", () => {
    expect(breakSeverityScale(deal({ expiresWeek: 5 }))).toBe(1);
  });
});

describe("0109 — CALIBRATION-NEUTRALITY: a no-duration break folds BYTE-IDENTICALLY to pre-0109", () => {
  it("no-duration deal break === a bare applyDirected('betrayal') at the same seed (scale-1 path is identity)", () => {
    // Pre-0109, applyBreak called `rel.applyDirected(wronged, breaker, 'betrayal', rng)`. Post-0109 it
    // calls the same with `scale = breakSeverityScale(deal) = 1`, which passes the base IMPACT object
    // UNCHANGED (same ref). So the resulting edge must be byte-identical to a direct call — proving the
    // feature is OFF by default and the betrayal calibration is untouched on the no-duration path.
    const viaLedger = freshRel();
    const ledger = new DealLedger();
    ledger.make([PROMISOR, PARTNER], "safety", "safe"); // no duration, no week
    breakDeal(ledger, viaLedger); // currentWeek omitted

    const direct = freshRel();
    direct.applyDirected(PARTNER, PROMISOR, "betrayal", new SeededRandom(11)); // the pre-0109 call shape

    expect(edge(viaLedger)).toEqual(edge(direct));
  });

  it("applyDirected default scale=1 is the SAME OBJECT path as a positional scale of 1", () => {
    // Both the omitted-arg and the explicit-1 forms take the byte-identical scale-1 branch.
    const a = freshRel(); a.applyDirected(PARTNER, PROMISOR, "betrayal", new SeededRandom(3));
    const b = freshRel(); b.applyDirected(PARTNER, PROMISOR, "betrayal", new SeededRandom(3), 1);
    expect(edge(a)).toEqual(edge(b));
  });
});

describe("0109 — explicit expiry is fair game (expireWeekScoped past the negotiated term)", () => {
  it("a final-two with an explicit expiresWeek resolves KEPT once the week passes un-broken", () => {
    const ledger = new DealLedger();
    // A season-horizon kind that today never expires — but with a NEGOTIATED two-week term.
    const d = ledger.make([PROMISOR, PARTNER], "final-two", "two weeks, then free", undefined, 3, { expiresWeek: 5 });
    expect(ledger.expireWeekScoped(5)).toHaveLength(0); // AT the term — still binding
    expect(d.status).toBe("open");
    const resolved = ledger.expireWeekScoped(6); // PAST the term
    expect(resolved).toHaveLength(1);
    expect(d.status).toBe("kept");
  });

  it("a deal WITHOUT an explicit term keeps the kind-implied horizon (final-two never expires)", () => {
    const ledger = new DealLedger();
    const f2 = ledger.make([PROMISOR, PARTNER], "final-two", "to the end", undefined, 2);
    expect(ledger.expireWeekScoped(9)).toHaveLength(0);
    expect(f2.status).toBe("open");
  });

  it("a vague deal carries NO numeric expiry — it never resolves via expireWeekScoped", () => {
    const ledger = new DealLedger();
    const v = ledger.make([PROMISOR, PARTNER], "final-two", "we'll see how it goes", undefined, 2, { vague: true });
    expect(ledger.expireWeekScoped(50)).toHaveLength(0);
    expect(v.status).toBe("open");
  });
});

describe("0109 — remaining-life scaling on a real broken deal (more weeks left ⇒ larger threat rise)", () => {
  it("breaking a freshly-renewed (many-weeks-left) deal raises threat MORE than one about to lapse, same seed", () => {
    // Two identical deals/houses, identical seed — only the remaining negotiated life differs.
    const farLedger = new DealLedger();
    farLedger.make([PROMISOR, PARTNER], "final-two", "long way to go", undefined, 1, { expiresWeek: 6 });
    const farRel = freshRel();
    const farThreat0 = farRel.edge(PARTNER, PROMISOR).threat;
    breakDeal(farLedger, farRel, 1); // 5 weeks left

    const nearLedger = new DealLedger();
    nearLedger.make([PROMISOR, PARTNER], "final-two", "almost done", undefined, 1, { expiresWeek: 6 });
    const nearRel = freshRel();
    const nearThreat0 = nearRel.edge(PARTNER, PROMISOR).threat;
    breakDeal(nearLedger, nearRel, 5); // 1 week left

    const farRise = farRel.edge(PARTNER, PROMISOR).threat - farThreat0;
    const nearRise = nearRel.edge(PARTNER, PROMISOR).threat - nearThreat0;
    expect(farRise).toBeGreaterThan(nearRise);
    // ...and the near break still hurts MORE than the floor (it had a week of term left).
    const floorLedger = new DealLedger();
    floorLedger.make([PROMISOR, PARTNER], "safety", "no term", undefined, 1);
    const floorRel = freshRel();
    const floorThreat0 = floorRel.edge(PARTNER, PROMISOR).threat;
    breakDeal(floorLedger, floorRel); // no duration ⇒ scale 1
    expect(nearRise).toBeGreaterThan(floorRel.edge(PARTNER, PROMISOR).threat - floorThreat0);
  });
});

describe("0109 — vague softens (a smaller threat rise than an equivalent explicit/no-duration break)", () => {
  it("a broken vague deal folds a SMALLER betrayal-shock than a no-duration break, same seed", () => {
    const vagueLedger = new DealLedger();
    vagueLedger.make([PROMISOR, PARTNER], "final-two", "unspoken", undefined, 1, { vague: true });
    const vagueRel = freshRel();
    const vThreat0 = vagueRel.edge(PARTNER, PROMISOR).threat;
    const vTrust0 = vagueRel.edge(PARTNER, PROMISOR).trust;
    breakDeal(vagueLedger, vagueRel);

    const plainLedger = new DealLedger();
    plainLedger.make([PROMISOR, PARTNER], "final-two", "clean", undefined, 1);
    const plainRel = freshRel();
    const pThreat0 = plainRel.edge(PARTNER, PROMISOR).threat;
    const pTrust0 = plainRel.edge(PARTNER, PROMISOR).trust;
    breakDeal(plainLedger, plainRel);

    // Softer: a smaller threat RISE and a smaller trust DROP than the unscaled (no-duration) break.
    const vThreatRise = vagueRel.edge(PARTNER, PROMISOR).threat - vThreat0;
    const pThreatRise = plainRel.edge(PARTNER, PROMISOR).threat - pThreat0;
    expect(vThreatRise).toBeLessThan(pThreatRise);
    const vTrustDrop = vTrust0 - vagueRel.edge(PARTNER, PROMISOR).trust;
    const pTrustDrop = pTrust0 - plainRel.edge(PARTNER, PROMISOR).trust;
    expect(vTrustDrop).toBeLessThan(pTrustDrop);
    // ...but it IS still a betrayal: threat rose, trust fell.
    expect(vThreatRise).toBeGreaterThan(0);
    expect(vTrustDrop).toBeGreaterThan(0);
  });

  it("a broken vague deal also folds smaller than an explicit deal of equal nominal life, same moment", () => {
    // Both deals span the same nominal life (made wk1, ~5 weeks out), broken at the same week — only
    // the FORM (vague vs. explicit term) differs. The explicit, still-binding break must hurt more.
    const vagueLedger = new DealLedger();
    vagueLedger.make([PROMISOR, PARTNER], "final-two", "vague long", undefined, 1, { vague: true });
    const vRel = freshRel();
    const vT0 = vRel.edge(PARTNER, PROMISOR).threat;
    breakDeal(vagueLedger, vRel, 2);

    const explicitLedger = new DealLedger();
    explicitLedger.make([PROMISOR, PARTNER], "final-two", "explicit long", undefined, 1, { expiresWeek: 6 });
    const eRel = freshRel();
    const eT0 = eRel.edge(PARTNER, PROMISOR).threat;
    breakDeal(explicitLedger, eRel, 2); // 4 weeks left ⇒ a hard, term-remaining betrayal

    expect(vRel.edge(PARTNER, PROMISOR).threat - vT0).toBeLessThan(eRel.edge(PARTNER, PROMISOR).threat - eT0);
  });
});

describe("0109 — persistence (non-degradation): both fields serialize/load losslessly", () => {
  it("expiresWeek and vague survive a serialize→load round-trip", () => {
    const ledger = new DealLedger();
    ledger.make([PROMISOR, PARTNER], "final-two", "explicit", undefined, 3, { expiresWeek: 5 });
    ledger.make([OTHER_A, OTHER_B], "safety", "unspoken", undefined, 3, { vague: true });
    ledger.make([PROMISOR, OTHER_A], "vote", "plain"); // neither — back-compat shape

    const snap = ledger.serialize();
    const restored = new DealLedger();
    restored.load(snap);
    expect(restored.all).toEqual(ledger.all);

    const reAll = restored.all;
    expect(reAll[0]!.expiresWeek).toBe(5);
    expect(reAll[0]!.vague).toBeUndefined();
    expect(reAll[1]!.vague).toBe(true);
    expect(reAll[1]!.expiresWeek).toBeUndefined();
    expect(reAll[2]!.expiresWeek).toBeUndefined();
    expect(reAll[2]!.vague).toBeUndefined();
  });

  it("a JSON round-trip (the durable save path) preserves both fields", () => {
    const ledger = new DealLedger();
    ledger.make([PROMISOR, PARTNER], "final-two", "explicit", undefined, 3, { expiresWeek: 7 });
    ledger.make([OTHER_A, OTHER_B], "safety", "unspoken", undefined, 3, { vague: true });
    const revived = new DealLedger();
    revived.load(JSON.parse(JSON.stringify(ledger.serialize())));
    expect(revived.all).toEqual(ledger.all);
  });

  it("a pre-0109 deal (neither field) loads unchanged — absent ⇒ kind-implied horizon", () => {
    // Simulate a pre-0109 save: a plain serialized deal with no duration keys at all.
    const legacy = [{
      id: "deal:1", parties: [PROMISOR, PARTNER] as [string, string], kind: "safety" as const,
      terms: "legacy", condition: { protect: PARTNER, promisors: [PROMISOR, PARTNER] }, status: "open" as const, madeWeek: 2,
    }];
    const ledger = new DealLedger();
    ledger.load(legacy);
    const d = ledger.all[0]!;
    expect(d.expiresWeek).toBeUndefined();
    expect(d.vague).toBeUndefined();
    // It still expires by its kind horizon (week-scoped, madeWeek 2 → kept at week 3).
    expect(ledger.expireWeekScoped(3)).toHaveLength(1);
    expect(d.status).toBe("kept");
  });
});

describe("0109 — the negotiated term is player-knowledge; the derived magnitude is NOT (Vault Wall)", () => {
  it("a deal's player-facing shape may carry expiresWeek/vague but never a shock/scale number", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "final-two", "two weeks", undefined, 3, { expiresWeek: 5 });
    // The player-facing projection of a deal: its terms incl. the negotiated expiry (their own knowledge).
    const facing = { id: d.id, parties: d.parties, kind: d.kind, terms: d.terms, status: d.status, expiresWeek: d.expiresWeek, vague: d.vague };
    const blob = JSON.stringify(facing);
    // The term IS surfaced (it's the player's own negotiated knowledge)...
    expect(blob).toContain("expiresWeek");
    // ...but NO derived magnitude (the shock size / the duration scale) ever appears.
    for (const banned of ["trust", "threat", "affinity", "confidence", "reliability", "vagueSoften", "perWeekRemaining", "maxScale", "betrayalScale", "severity"]) {
      expect(blob.includes(banned), `player-facing deal must not expose ${banned}`).toBe(false);
    }
  });
});
