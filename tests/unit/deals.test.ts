import { describe, it, expect } from "vitest";
import { DealLedger } from "../../src/engine/deals";
import type { BindingAction } from "../../src/domain/deal";
import { actionBreaks, actionHonors, conditionFor } from "../../src/domain/deal";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER } from "../../src/domain/ids";

// Roles only (HARD rule): promisor, promisee/partner, wronged party — never names.
const PROMISOR = "promisor";
const PARTNER = "partner";
const HOH = "hoh";

describe("0039 — deal model & ledger (pure core)", () => {
  it("a made deal is a first-class OPEN object with parties, kind, terms, condition", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "safety", "I won't put you up");
    expect(d.status).toBe("open");
    expect(d.parties).toEqual([PROMISOR, PARTNER]);
    expect(d.kind).toBe("safety");
    expect(d.terms).toBe("I won't put you up");
    expect(d.condition.protect).toBe(PARTNER);
    expect(ledger.open()).toHaveLength(1);
  });

  it("the engine decides broken from action + condition (a promisor moving against the partner)", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "safety", "safe");
    const nominateThePartner: BindingAction = { actor: PROMISOR, kind: "nominate", targets: [PARTNER, "someone"] };
    expect(actionBreaks(d, nominateThePartner)).toBe(true);
  });

  it("honoring (nominating someone else) BUILDS trust and keeps the deal binding until its horizon (E43)", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "safety", "safe", undefined, 2);
    const rel = new RelationshipModel(0.5);
    const before = { ...rel.edge(PARTNER, PROMISOR) };
    const nominateOthers: BindingAction = { actor: PROMISOR, kind: "nominate", targets: ["x", "y"] };
    const r = ledger.reconcile(nominateOthers, { rel, rng: new SeededRandom(1) });
    expect(r.broken).toHaveLength(0);
    // E43: a nomination that spares the partner HONORS the promise but does not END it — the
    // safety deal still binds through this week's eviction (the pre-E43 bug self-extinguished it).
    expect(d.status).toBe("open");
    // ...and a kept promise finally BUILDS trust (plus the E54 evidence signal). Never a betrayal.
    const after = rel.edge(PARTNER, PROMISOR);
    expect(after.trust).toBeGreaterThan(before.trust);
    expect(after.reliability).toBeGreaterThan(before.reliability);
    expect(after.threat).toBeLessThanOrEqual(before.threat);
  });

  it("the eviction vote is the safety deal's horizon: an honoring vote resolves it KEPT (E43)", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "safety", "safe", undefined, 2);
    const r = ledger.reconcile(
      { actor: PROMISOR, kind: "vote-evict", targets: ["x"], alternatives: ["x", PARTNER] },
      { rel: new RelationshipModel(0.5), rng: new SeededRandom(1) },
    );
    expect(r.kept).toHaveLength(1);
    expect(d.status).toBe("kept");
  });

  it("a final-two deal does NOT self-extinguish at an unrelated later nomination (E43)", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "final-two", "ride or die", undefined, 2);
    // Week 3: the promisor nominates two OTHER houseguests — honoring, not concluding.
    ledger.reconcile({ actor: PROMISOR, kind: "nominate", targets: ["x", "y"] });
    expect(d.status).toBe("open");
    expect(ledger.open()).toHaveLength(1);
    // ...and it still BREAKS with full consequence weeks later.
    const r = ledger.reconcile({ actor: PROMISOR, kind: "vote-evict", targets: [PARTNER] });
    expect(r.broken).toHaveLength(1);
    expect(d.status).toBe("broken");
  });

  it("week-scoped deals expire KEPT once their week passes un-broken; final-two never expires (E43)", () => {
    const ledger = new DealLedger();
    const safety = ledger.make([PROMISOR, PARTNER], "safety", "safe this week", undefined, 2);
    const f2 = ledger.make([PROMISOR, PARTNER], "final-two", "to the end", undefined, 2);
    expect(ledger.expireWeekScoped(2)).toHaveLength(0); // still week 2 — still binding
    const resolved = ledger.expireWeekScoped(3);
    expect(resolved).toHaveLength(1);
    expect(safety.status).toBe("kept");
    expect(f2.status).toBe("open");
  });

  it("with alternatives, sparing someone who was never an option proves nothing (E43)", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "final-two", "f2", undefined, 1);
    const rel = new RelationshipModel(0.5);
    const before = rel.edge(PARTNER, PROMISOR).trust;
    // The partner was NOT one of the nominees — this vote demonstrates nothing about the promise.
    ledger.reconcile(
      { actor: PROMISOR, kind: "vote-evict", targets: ["x"], alternatives: ["x", "y"] },
      { rel, rng: new SeededRandom(1) },
    );
    expect(d.status).toBe("open");
    expect(rel.edge(PARTNER, PROMISOR).trust).toBe(before); // no unearned honor fold
  });

  it("breaking a deal hurts: wronged trust drops, threat rises (betrayal-shock), and lingers", () => {
    const ledger = new DealLedger();
    ledger.make([PROMISOR, PARTNER], "safety", "safe");
    const rel = new RelationshipModel(0.5);
    const t0 = rel.edge(PARTNER, PROMISOR).trust;
    const th0 = rel.edge(PARTNER, PROMISOR).threat;
    const breakIt: BindingAction = { actor: PROMISOR, kind: "nominate", targets: [PARTNER] };
    ledger.reconcile(breakIt, { rel, rng: new SeededRandom(1) });
    const e = rel.edge(PARTNER, PROMISOR);
    expect(e.trust).toBeLessThan(t0);
    expect(e.threat).toBeGreaterThan(th0);
    // Sticky: a few neglect cycles do not erase the grudge (threat decays slowest).
    rel.decay(0.1); rel.decay(0.1);
    expect(rel.edge(PARTNER, PROMISOR).threat).toBeGreaterThan(th0);
  });

  it("a broken deal raises a jury demerit and a reveal for the wronged party", () => {
    const ledger = new DealLedger();
    ledger.make([PROMISOR, PARTNER], "final-two", "ride or die");
    const demerits: Array<[string, string]> = [];
    const reveals: Array<[string, string]> = [];
    ledger.reconcile(
      { actor: PROMISOR, kind: "vote-evict", targets: [PARTNER] },
      {
        rel: new RelationshipModel(0.5), rng: new SeededRandom(1),
        juryDemerit: (w, b) => demerits.push([w, b]),
        reveal: (w, b) => { reveals.push([w, b]); return "evt:reveal:1"; },
      },
    );
    expect(demerits).toEqual([[PARTNER, PROMISOR]]);
    expect(reveals).toEqual([[PARTNER, PROMISOR]]);
  });

  // A7/E12 — the sealed-ballot plumbing `reconcile` hands the sink so it can withhold ballot-tied
  // attribution until the same terminal gate the primary eviction reveal (and the 0048 retrospective)
  // use. Pure-domain proof that the mechanism threads correctly; the adapter-level seal itself (which
  // event gets minted, and to whom) is proved in tests/unit/ballotAttributionSeal.test.ts.
  describe("A7 — the triggering action's kind threads to the sink (sealed-ballot plumbing)", () => {
    it("reveal/witnessed both receive the BindingAction.kind that caused the break", () => {
      const ledger = new DealLedger();
      ledger.make([PROMISOR, PARTNER], "safety", "safe");
      const revealKinds: string[] = [];
      const witnessedKinds: string[] = [];
      ledger.reconcile(
        { actor: PROMISOR, kind: "vote-evict", targets: [PARTNER] },
        {
          witnessed: (_w, _b, _d, actionKind) => { witnessedKinds.push(actionKind); return true; },
          reveal: (_w, _b, _d, actionKind) => { revealKinds.push(actionKind); return "evt:1"; },
        },
      );
      expect(witnessedKinds).toEqual(["vote-evict"]);
      expect(revealKinds).toEqual(["vote-evict"]);
    });

    it("marks `sealedBallot` when a SEALED eviction vote (not the breaker's own) breaks the deal", () => {
      const ledger = new DealLedger();
      const d = ledger.make([PROMISOR, PARTNER], "vote", "vote with me");
      ledger.reconcile({ actor: PROMISOR, kind: "vote-evict", targets: [PARTNER] });
      expect(d.status).toBe("broken");
      expect(d.sealedBallot).toBe(true);
    });

    it("does NOT seal a break triggered by a PUBLIC action (a nomination is never secret)", () => {
      const ledger = new DealLedger();
      const d = ledger.make([PROMISOR, PARTNER], "safety", "safe");
      ledger.reconcile({ actor: PROMISOR, kind: "nominate", targets: [PARTNER] });
      expect(d.status).toBe("broken");
      expect(d.sealedBallot).toBeFalsy();
    });

    it("does NOT seal a break the PLAYER caused themselves (their own vote is never sealed from them)", () => {
      const ledger = new DealLedger();
      const d = ledger.make([PLAYER, PARTNER], "vote", "vote with me");
      ledger.reconcile({ actor: PLAYER, kind: "vote-evict", targets: [PARTNER] });
      expect(d.status).toBe("broken");
      expect(d.sealedBallot).toBeFalsy();
    });
  });

  it("no reveal when the wronged party does not witness/learn the break", () => {
    const ledger = new DealLedger();
    ledger.make([PROMISOR, PARTNER], "safety", "safe");
    let revealed = false;
    ledger.reconcile(
      { actor: PROMISOR, kind: "nominate", targets: [PARTNER] },
      { witnessed: () => false, reveal: () => { revealed = true; return "x"; } },
    );
    expect(revealed).toBe(false);
  });

  it("using the veto to SAVE the partner is never a betrayal (non-adverse action)", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "safety", "safe");
    const saveThem: BindingAction = { actor: PROMISOR, kind: "veto-use", targets: [PARTNER] };
    expect(actionBreaks(d, saveThem)).toBe(false);
    const r = ledger.reconcile(saveThem);
    expect(r.broken).toHaveLength(0);
    expect(d.status).toBe("open");
  });

  it("target-other binds only the promisor, not the partner", () => {
    const cond = conditionFor("target-other", [PROMISOR, PARTNER]);
    expect(cond.promisors).toEqual([PROMISOR]);
    const d = { id: "d", parties: [PROMISOR, PARTNER] as [string, string], kind: "target-other" as const, terms: "", condition: cond, status: "open" as const };
    // The partner moving against the promisor does NOT break a one-way target-other deal.
    expect(actionBreaks(d, { actor: PARTNER, kind: "nominate", targets: [PROMISOR] })).toBe(false);
    // The promisor moving against the partner DOES.
    expect(actionBreaks(d, { actor: PROMISOR, kind: "nominate", targets: [PARTNER] })).toBe(true);
  });

  it("an already-resolved deal is inert to further actions", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "safety", "safe");
    ledger.reconcile({ actor: PROMISOR, kind: "nominate", targets: [PARTNER] });
    expect(d.status).toBe("broken");
    const r2 = ledger.reconcile({ actor: PROMISOR, kind: "vote-evict", targets: [PARTNER] });
    expect(r2.broken).toHaveLength(0);
  });

  it("serialize/load round-trips losslessly (persistence 0030)", () => {
    const ledger = new DealLedger();
    ledger.make([PROMISOR, PARTNER], "safety", "safe");
    ledger.make([HOH, PARTNER], "vote", "I keep you");
    const snap = ledger.serialize();
    const restored = new DealLedger();
    restored.load(snap);
    expect(restored.all).toEqual(ledger.all);
    // Continues without colliding ids.
    const next = restored.make([HOH, PROMISOR], "final-two", "f2");
    expect(next.id).toBe("deal:3");
  });

  it("a party HONORS only when they had the chance and spared the partner", () => {
    const d = { id: "d", parties: ["a", "b"] as [string, string], kind: "safety" as const, terms: "", condition: conditionFor("safety", ["a", "b"]), status: "open" as const };
    expect(actionHonors(d, { actor: "a", kind: "nominate", targets: ["c", "d"] })).toBe(true);
    expect(actionHonors(d, { actor: "a", kind: "nominate", targets: ["b"] })).toBe(false); // that's a break, not honor
    expect(actionHonors(d, { actor: "c", kind: "nominate", targets: ["d"] })).toBe(false); // not a party
  });

  it("G19 (T9 dead-export removal): the module no longer exports the superseded actionImplicates — reconcile() decides kept/broken from actionBreaks/actionHonors alone, never a pre-filter", async () => {
    const dealModule: Record<string, unknown> = await import("../../src/domain/deal");
    expect("actionImplicates" in dealModule).toBe(false);
  });
});
