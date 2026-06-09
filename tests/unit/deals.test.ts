import { describe, it, expect } from "vitest";
import { DealLedger } from "../../src/engine/deals";
import type { BindingAction } from "../../src/domain/deal";
import { actionBreaks, actionHonors, conditionFor } from "../../src/domain/deal";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

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

  it("honoring (nominating someone else) leaves it kept, no betrayal", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PARTNER], "safety", "safe");
    const rel = new RelationshipModel(0.5);
    const before = { ...rel.edge(PARTNER, PROMISOR) };
    const nominateOthers: BindingAction = { actor: PROMISOR, kind: "nominate", targets: ["x", "y"] };
    const r = ledger.reconcile(nominateOthers, { rel, rng: new SeededRandom(1) });
    expect(r.kept).toHaveLength(1);
    expect(r.broken).toHaveLength(0);
    expect(d.status).toBe("kept");
    // No relationship move — the deal was honored.
    expect(rel.edge(PARTNER, PROMISOR)).toEqual(before);
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
});
