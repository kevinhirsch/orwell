import { describe, it, expect } from "vitest";
import { DealLedger } from "../../src/engine/deals";
import type { ReconcileSink } from "../../src/engine/deals";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";

/**
 * Feature 0121 (PO expansion of the 0039 review) — ACTIVE-obligation deal kinds. `comp-throw` ("I'll throw
 * this comp for you") and `veto-save` ("I'll use the veto to save you") are POSITIVE promises: a break is a
 * FAILURE TO ACT, engine-decided from the structured action (never prose). Broken ones reuse the full 0039
 * fallout (betrayal-shock + jury demerit + reveal). Roles only.
 */

const PROMISOR = npc(1);
const PROTECT = npc(2);
const OTHER = npc(3);
const FOURTH = npc(4);

function sink() {
  const rel = new RelationshipModel(0.5);
  const demerits: Array<{ wronged: string; breaker: string }> = [];
  const box = { reveals: 0 };
  const s: ReconcileSink = {
    rel,
    rng: new SeededRandom(7),
    juryDemerit: (wronged, breaker) => demerits.push({ wronged, breaker }),
    reveal: () => { box.reveals++; return `evt:${box.reveals}`; },
  };
  return { s, rel, demerits, box };
}

describe("0121 — comp-throw: a promise to tank a competition", () => {
  it("is KEPT when the promisor throws the comp", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PROTECT], "comp-throw", "I'll throw the HOH so you win");
    expect(d.status).toBe("open");
    ledger.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome: "threw" }, sink().s);
    expect(d.status).toBe("kept");
  });

  it("is BROKEN when the promisor competes or wins anyway — and reuses the 0039 fallout", () => {
    for (const outcome of ["competed", "won"] as const) {
      const ledger = new DealLedger();
      const bag = sink();
      const d = ledger.make([PROMISOR, PROTECT], "comp-throw", "throw it");
      const trustBefore = bag.rel.edge(PROTECT, PROMISOR).trust;
      ledger.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome }, bag.s);
      expect(d.status, `outcome=${outcome}`).toBe("broken");
      // The wronged party (the one promised the throw) takes the betrayal hit against the breaker.
      expect(bag.rel.edge(PROTECT, PROMISOR).trust).toBeLessThan(trustBefore);
      expect(bag.demerits).toEqual([{ wronged: PROTECT, breaker: PROMISOR }]);
      expect(bag.box.reveals).toBe(1);
    }
  });
});

describe("0121 — veto-save: a promise to use the veto to save you", () => {
  it("is KEPT when the veto-holder pulls the promisee off the block", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PROTECT], "veto-save", "I'll veto you down");
    ledger.reconcile(
      { actor: PROMISOR, kind: "veto-use", targets: [], saved: [PROTECT], nominees: [PROTECT, OTHER] },
      sink().s,
    );
    expect(d.status).toBe("kept");
  });

  it("is BROKEN when the promisee is on the block and the veto-holder leaves them there", () => {
    const ledger = new DealLedger();
    const bag = sink();
    const d = ledger.make([PROMISOR, PROTECT], "veto-save", "I'll veto you down");
    ledger.reconcile(
      { actor: PROMISOR, kind: "veto-use", targets: [], saved: [OTHER], nominees: [PROTECT, OTHER] },
      bag.s,
    );
    expect(d.status).toBe("broken");
    expect(bag.demerits).toEqual([{ wronged: PROTECT, breaker: PROMISOR }]);
  });

  it("does NOT trigger when the promisee was never on the block (no duty to save)", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PROTECT], "veto-save", "I'll veto you down");
    ledger.reconcile(
      { actor: PROMISOR, kind: "veto-use", targets: [], saved: [OTHER], nominees: [OTHER, FOURTH] },
      sink().s,
    );
    expect(d.status).toBe("open"); // the promised party wasn't nominated — nothing owed
  });
});

describe("0121 — the verdict is engine-decided, never prose", () => {
  it("the same action yields the same verdict regardless of the terms wording", () => {
    const plain = new DealLedger();
    const dp = plain.make([PROMISOR, PROTECT], "comp-throw", "throw");
    plain.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome: "won" }, sink().s);

    const flowery = new DealLedger();
    const df = flowery.make([PROMISOR, PROTECT], "comp-throw", "a long, heartfelt, flowery pledge to tank");
    flowery.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome: "won" }, sink().s);

    expect(df.status).toBe(dp.status);
    expect(dp.status).toBe("broken");
  });

  it("the new kinds leave the existing defensive kinds byte-identical (safety still adjudicates as before)", () => {
    const ledger = new DealLedger();
    const d = ledger.make([PROMISOR, PROTECT], "safety", "I won't put you up");
    // A safety deal is untouched by a `compete` action (not its trigger) and still breaks on a nomination.
    ledger.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome: "won" }, sink().s);
    expect(d.status).toBe("open");
    ledger.reconcile({ actor: PROMISOR, kind: "nominate", targets: [PROTECT, OTHER] }, sink().s);
    expect(d.status).toBe("broken");
  });
});
