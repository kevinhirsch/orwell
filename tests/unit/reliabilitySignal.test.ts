import { describe, it, expect } from "vitest";
import { RelationshipModel } from "../../src/engine/relationships";
import { RELATIONSHIP_CONSTANTS, CEREMONY_IMPACTS, DEAL_IMPACTS } from "../../src/engine/relationshipConstants";
import { DealLedger } from "../../src/engine/deals";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";

/**
 * Audit E54 — ADR 0002's `reliability` signal: EVIDENCE of loyalty, distinct from trust
 * sentiment. Fed by honored deals and protective binding acts (the veto save), torn down by
 * betrayal, consumed by `bondStrength`, persisted losslessly. Roles only.
 */

const A = npc(1);
const B = npc(2);

describe("E54 — the reliability (evidence) signal", () => {
  it("starts at the unproven baseline and is fed by the protective ceremony act (the veto save)", () => {
    const rel = new RelationshipModel(0.5);
    const base = RELATIONSHIP_CONSTANTS.baseline.reliability;
    expect(rel.edge(A, B).reliability).toBe(base);
    expect(CEREMONY_IMPACTS["veto-saved"].reliability ?? 0).toBeGreaterThan(0);
    rel.applyImpactDirected(A, B, CEREMONY_IMPACTS["veto-saved"], new SeededRandom(1));
    expect(rel.edge(A, B).reliability).toBeGreaterThan(base);
  });

  it("an honored deal raises it; a betrayal tears it down harder than sentiment-only impacts do", () => {
    const rel = new RelationshipModel(0.5);
    const ledger = new DealLedger();
    ledger.make([A, B], "safety", "safe", undefined, 1);
    ledger.reconcile(
      { actor: A, kind: "vote-evict", targets: ["x"], alternatives: ["x", B] },
      { rel, rng: new SeededRandom(2) },
    );
    const honored = rel.edge(B, A).reliability;
    expect(honored).toBeGreaterThan(RELATIONSHIP_CONSTANTS.baseline.reliability);
    expect(DEAL_IMPACTS.honored.reliability ?? 0).toBeGreaterThan(0);

    // A betrayal destroys the evidence.
    rel.applyDirected(B, A, "betrayal", new SeededRandom(3));
    expect(rel.edge(B, A).reliability).toBeLessThan(honored);
    expect(RELATIONSHIP_CONSTANTS.BETRAYAL_SHOCK.reliability ?? 0).toBeLessThan(0);
  });

  it("bondStrength weighs demonstrated loyalty: identical sentiment, proven partner reads stronger", () => {
    const rel = new RelationshipModel(0.5);
    for (const other of [B, npc(3)]) {
      const e = rel.edge(A, other);
      e.trust = 0.5; e.affinity = 0.5;
    }
    rel.edge(A, B).reliability = 0.8;  // proved themselves
    rel.edge(A, npc(3)).reliability = 0.3; // pleasant, unproven
    expect(rel.bondStrength(A, B)).toBeGreaterThan(rel.bondStrength(A, npc(3)));
    // ...and the proven partner wins a Houseguest's-Choice style pick.
    expect(rel.chooseStrongestBond(A, [B, npc(3)], new SeededRandom(4), 0)).toBe(B);
  });

  it("evidence does not decay on neglect (proof stands until contradicted) and round-trips losslessly", () => {
    const rel = new RelationshipModel(0.5);
    rel.edge(A, B).reliability = 0.9;
    rel.decay(0.2); rel.decay(0.2);
    expect(rel.edge(A, B).reliability).toBe(0.9);

    const revived = new RelationshipModel(0.5);
    revived.load(rel.serialize().edges);
    expect(revived.edge(A, B).reliability).toBe(0.9);
  });

  it("pre-E54 saves (no reliability field) load at the unproven baseline", () => {
    const rel = new RelationshipModel(0.5);
    rel.load([{ from: A, to: B, trust: 0.7, affinity: 0.6, threat: 0.2, alignment: 0.4, confidence: 0.5 }]);
    expect(rel.edge(A, B).reliability).toBe(RELATIONSHIP_CONSTANTS.baseline.reliability);
    expect(rel.edge(A, B).trust).toBe(0.7); // nothing else disturbed
  });
});
