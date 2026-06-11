import { describe, it, expect } from "vitest";
import { RelationshipModel } from "../../src/engine/relationships";
import { RELATIONSHIP_CONSTANTS, CEREMONY_IMPACTS, DEAL_IMPACTS } from "../../src/engine/relationshipConstants";
import { DealLedger } from "../../src/engine/deals";
import { juryLean, JURY_WEIGHTS } from "../../src/engine/jury";
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

  it("the veto-save pick consumes reliability: a proven protector outranks an equally-liked stranger", () => {
    // E54 consumption tail — `chooseVetoSave`. Two saveable nominees, identical sentiment (both
    // above the save bar); only one has a protective track record (high reliability). The holder
    // saves the one who actually had their back. Roles only: holder, provenNominee, freshNominee.
    const rel = new RelationshipModel(0.5);
    const holder = npc(1), provenNominee = npc(2), freshNominee = npc(3);
    for (const n of [provenNominee, freshNominee]) {
      const e = rel.edge(holder, n);
      e.trust = 0.7; e.affinity = 0.7; // equally liked, both clear thresholds.vetoSave
    }
    rel.edge(holder, provenNominee).reliability = 0.9; // demonstrated loyalty
    rel.edge(holder, freshNominee).reliability = RELATIONSHIP_CONSTANTS.baseline.reliability; // no track record

    expect(rel.vetoSaveScore(holder, provenNominee)).toBeGreaterThan(rel.vetoSaveScore(holder, freshNominee));
    // Array order lists the unproven nominee first — reliability, not slot, must decide the save.
    expect(rel.chooseVetoSave(holder, [freshNominee, provenNominee])).toBe(provenNominee);
    expect(rel.chooseVetoSave(holder, [provenNominee, freshNominee])).toBe(provenNominee);
    // No candidate clears the save bar ⇒ the holder pockets the veto.
    expect(rel.chooseVetoSave(holder, [npc(9)])).toBeUndefined();
  });

  it("juryLean moves with reliability at fixed manner/lean inputs", () => {
    // E54 consumption tail — `juryLean`. Same trust/affinity/threat and manner; only the centered
    // reliability evidence term differs. A juror leans further toward the finalist who proved loyal.
    const base = { trust: 0.5, affinity: 0.5, threat: 0.2 } as const;
    const neutral = juryLean({ ...base, reliability: 0 });
    const proven = juryLean({ ...base, reliability: 0.6 });
    const disloyal = juryLean({ ...base, reliability: -0.6 });
    expect(proven).toBeGreaterThan(neutral);
    expect(disloyal).toBeLessThan(neutral);
    // The lift is exactly the weighted, centered evidence term — nothing else moved.
    expect(proven - neutral).toBeCloseTo(JURY_WEIGHTS.reliability * 0.6, 10);
    // An absent reliability term reads neutral (older call sites, defaulting to 0).
    expect(juryLean(base)).toBe(neutral);
  });

  it("pre-E54 saves (no reliability field) load at the unproven baseline", () => {
    const rel = new RelationshipModel(0.5);
    rel.load([{ from: A, to: B, trust: 0.7, affinity: 0.6, threat: 0.2, alignment: 0.4, confidence: 0.5 }]);
    expect(rel.edge(A, B).reliability).toBe(RELATIONSHIP_CONSTANTS.baseline.reliability);
    expect(rel.edge(A, B).trust).toBe(0.7); // nothing else disturbed
  });
});
