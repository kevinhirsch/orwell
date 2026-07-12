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

describe("0121 — the loyalty streak: consecutive kept deals compound (deal-depth reward)", () => {
  const keepOnce = (ledger: DealLedger, s: ReconcileSink, rel: RelationshipModel, tag: string): number => {
    const before = rel.edge(PROTECT, PROMISOR).reliability;
    ledger.make([PROMISOR, PROTECT], "comp-throw", `throw ${tag}`);
    ledger.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome: "threw" }, s);
    return rel.edge(PROTECT, PROMISOR).reliability - before;
  };

  it("a second kept deal with the same partner builds MORE reliability than the first (compounds)", () => {
    const rel = new RelationshipModel(0.5);
    const s: ReconcileSink = { rel, rng: new SeededRandom(7), dealDepth: true };
    const ledger = new DealLedger();
    const gain1 = keepOnce(ledger, s, rel, "1");
    const gain2 = keepOnce(ledger, s, rel, "2");
    expect(gain2).toBeGreaterThan(gain1); // the "we've never broken faith" bonus
  });

  it("with the deal-depth layer OFF, consecutive kept deals build the SAME amount (byte-identical fold)", () => {
    const rel = new RelationshipModel(0.5);
    const s: ReconcileSink = { rel, rng: new SeededRandom(7) }; // dealDepth unset
    const ledger = new DealLedger();
    const gain1 = keepOnce(ledger, s, rel, "1");
    const gain2 = keepOnce(ledger, s, rel, "2");
    expect(gain2).toBeCloseTo(gain1, 10); // no streak — identical honored fold
  });

  it("a broken deal resets the streak (loyalty must be rebuilt)", () => {
    const rel = new RelationshipModel(0.5);
    const s: ReconcileSink = {
      rel, rng: new SeededRandom(7), dealDepth: true,
      juryDemerit: () => {}, reveal: () => "e",
    };
    const ledger = new DealLedger();
    keepOnce(ledger, s, rel, "1");
    const gain2 = keepOnce(ledger, s, rel, "2"); // streak = 2, a compounded gain
    // Now BREAK a deal with the same partner — resets the streak.
    const broken = ledger.make([PROMISOR, PROTECT], "comp-throw", "then betray");
    ledger.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome: "won" }, s);
    expect(broken.status).toBe("broken");
    const gainAfterReset = keepOnce(ledger, s, rel, "3"); // streak back to 1
    expect(gainAfterReset).toBeLessThan(gain2); // the compounding was lost — trust has to be rebuilt
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

describe("0121 R1 — the diffusing 'keeps their word' reputation seed (the sink hook fires on a KEPT deal)", () => {
  /** A sink that RECORDS every reputation seed the ledger emits, plus the deal-depth reward toggle. */
  function repSink(dealDepth: boolean) {
    const rel = new RelationshipModel(0.5);
    const seeds: Array<{ honorer: string; other: string }> = [];
    const s: ReconcileSink = {
      rel, rng: new SeededRandom(7), dealDepth,
      juryDemerit: () => {}, reveal: () => "e",
      reputation: (honorer, other) => { seeds.push({ honorer, other }); },
    };
    return { s, seeds };
  }

  it("a KEPT active-obligation deal seeds a reputation for the honorer, credited to the counterparty", () => {
    const ledger = new DealLedger();
    const { s, seeds } = repSink(true);
    ledger.make([PROMISOR, PROTECT], "comp-throw", "I'll throw the HOH for you");
    ledger.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome: "threw" }, s);
    // The honorer (who kept the throw) accrues the reputation; the party they kept it WITH is the origin holder.
    expect(seeds).toEqual([{ honorer: PROMISOR, other: PROTECT }]);
  });

  it("a BROKEN deal seeds NO reputation (you only build a name by KEEPING your word)", () => {
    const ledger = new DealLedger();
    const { s, seeds } = repSink(true);
    ledger.make([PROMISOR, PROTECT], "comp-throw", "throw it");
    ledger.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome: "won" }, s); // competed ⇒ broken
    expect(seeds).toEqual([]);
  });

  it("with the deal-depth layer OFF, a kept deal seeds NO reputation (byte-identical — nothing to diffuse)", () => {
    const ledger = new DealLedger();
    const { s, seeds } = repSink(false); // dealDepth off
    ledger.make([PROMISOR, PROTECT], "comp-throw", "throw it");
    ledger.reconcile({ actor: PROMISOR, kind: "compete", targets: [], outcome: "threw" }, s);
    expect(seeds).toEqual([]); // the reputation hook never fires when off
  });

  it("a mutual deal honored at its horizon seeds the reputation for the honoring actor", () => {
    const ledger = new DealLedger();
    const { s, seeds } = repSink(true);
    // A safety deal: the actor spares their partner at the eviction vote (the horizon) — that HONORS it.
    ledger.make([PROMISOR, PROTECT], "safety", "I keep you safe");
    ledger.reconcile(
      { actor: PROMISOR, kind: "vote-evict", targets: [OTHER], alternatives: [PROTECT, OTHER] },
      s,
    );
    expect(seeds).toEqual([{ honorer: PROMISOR, other: PROTECT }]);
  });
});
