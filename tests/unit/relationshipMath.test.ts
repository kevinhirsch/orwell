import { describe, it, expect } from "vitest";
import { RelationshipModel } from "../../src/engine/relationships";
import {
  RELATIONSHIP_CONSTANTS,
  type RelationshipConstants,
  type EdgeSignals,
} from "../../src/engine/relationshipConstants";
import { generateHouse, dispositionOf } from "../../src/engine/characterFactory";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

const A = npc(1);
const B = npc(2);
const C = npc(3);

/** A constants clone with a different betrayal magnitude — the single 'feel' knob. */
function withBetrayal(betrayal: Partial<EdgeSignals>): RelationshipConstants {
  return {
    ...RELATIONSHIP_CONSTANTS,
    BETRAYAL_SHOCK: betrayal,
    IMPACT: { ...RELATIONSHIP_CONSTANTS.IMPACT, betrayal },
  };
}

describe("0026 — relationship math (firmed rule, sticky default, per-game feel)", () => {
  it("a betrayal lingers through a quiet stretch (the sticky default)", () => {
    const rel = new RelationshipModel(0.6);
    const rng = new SeededRandom(1);
    for (let i = 0; i < 6; i++) rel.applyDirected(A, B, "bonding", rng); // an established, trusting edge
    const trustBefore = rel.edge(A, B).trust;

    rel.applyDirected(A, B, "betrayal", new SeededRandom(2));
    const trustAfterBetrayal = rel.edge(A, B).trust;
    const threatAfterBetrayal = rel.edge(A, B).threat;

    for (let i = 0; i < 6; i++) rel.decay(RELATIONSHIP_CONSTANTS.DECAY_RATE); // a quiet stretch
    const e = rel.edge(A, B);

    expect(trustAfterBetrayal).toBeLessThan(trustBefore - 0.2); // it dropped sharply
    expect(e.trust).toBeLessThan(trustBefore - 0.15); // and stays depressed (slow decay)
    expect(e.threat).toBeGreaterThan(RELATIONSHIP_CONSTANTS.baseline.threat); // wariness lingers
    expect(threatAfterBetrayal).toBeGreaterThan(0.2);
  });

  it("a betrayal is one sharp step (not a slope)", () => {
    const rel = new RelationshipModel(0.6);
    const rng = new SeededRandom(3);
    for (let i = 0; i < 5; i++) rel.apply(A, B, "bonding", rng);
    const before = { ...rel.edge(A, B) };
    rel.applyDirected(A, B, "betrayal", new SeededRandom(4));
    const after = rel.edge(A, B);
    expect(before.trust - after.trust).toBeGreaterThan(0.2); // sharp single-step drop
    expect(before.affinity - after.affinity).toBeGreaterThan(0.15);
    expect(after.threat - before.threat).toBeGreaterThan(0.15); // and a same-step threat jump
  });

  it("disposition changes how sticky the SAME history feels", () => {
    const rel = new RelationshipModel(0.6);
    rel.setDisposition(A, "clash"); // paranoid / grudge-holding
    rel.setDisposition(C, "bond"); // forgiving / loyal

    // Identical interaction history (same seeds ⇒ same jitter) — only the disposition differs.
    for (const [holder, seed] of [[A, 10] as const, [C, 10] as const]) {
      const rng = new SeededRandom(seed);
      for (let i = 0; i < 4; i++) rel.applyDirected(holder, B, "bonding", rng);
    }
    for (const [holder, seed] of [[A, 11] as const, [C, 11] as const]) {
      rel.applyDirected(holder, B, "betrayal", new SeededRandom(seed));
    }

    const clash = rel.edge(A, B);
    const bond = rel.edge(C, B);
    expect(clash.threat).toBeGreaterThan(bond.threat); // paranoid grudge is stronger
    expect(clash.trust).toBeLessThan(bond.trust);

    for (let i = 0; i < 5; i++) rel.decay(0.1); // a quiet stretch for both
    expect(rel.edge(A, B).threat).toBeGreaterThan(rel.edge(C, B).threat); // clash decays slower — still stickier
    expect(rel.edge(A, B).trust).toBeLessThan(rel.edge(C, B).trust); // bond recovers warmth faster
  });

  it("the feel varies measurably across casts/seeds, yet is reproducible by seed", () => {
    const stickiness = (seed: number): number => {
      const rel = new RelationshipModel(0.6);
      const house = generateHouse(new SeededRandom(seed));
      for (const n of house.npcs) rel.setDisposition(n.id, dispositionOf(n.character.archetype));
      for (const n of house.npcs) rel.applyDirected(n.id, PLAYER, "betrayal", new SeededRandom(seed));
      for (let i = 0; i < 4; i++) rel.decay(0.1);
      const residual = house.npcs.map((n) => rel.edge(n.id, PLAYER).threat);
      return residual.reduce((a, b) => a + b, 0) / residual.length; // aggregate grudge
    };

    const feels = Array.from({ length: 20 }, (_, i) => stickiness(i + 1));
    const spread = Math.max(...feels) - Math.min(...feels);
    expect(spread).toBeGreaterThan(0.01); // no two seasons feel identical

    for (const seed of [3, 7, 15]) expect(stickiness(seed)).toBe(stickiness(seed)); // reproducible
  });

  it("confidence firms up monotonically with interaction data", () => {
    const rel = new RelationshipModel(0.6);
    rel.applyDirected(A, B, "gossip", new SeededRandom(5));
    expect(rel.read(A, B).kind).toBe("suspicion");
    const c1 = rel.edge(A, B).confidence;
    const rng = new SeededRandom(6);
    for (let i = 0; i < 10; i++) rel.apply(A, B, "strategy", rng);
    const c2 = rel.edge(A, B).confidence;
    expect(c2).toBeGreaterThan(c1);
    expect(rel.read(A, B).kind).toBe("knowledge");
  });

  it("the feel is retunable from the one constants module — and nothing is hard-coded outside it", () => {
    // (a) A bigger betrayal-shock constant ⇒ a bigger drop. Build identical trust headroom first
    // (bonding uses default constants in both), then betray — so only the shock constant differs.
    const defaultRel = new RelationshipModel(0.6);
    const harsherRel = new RelationshipModel(0.6, withBetrayal({ trust: -0.6, affinity: -0.5, threat: +0.5 }));
    for (const r of [defaultRel, harsherRel]) {
      const rng = new SeededRandom(20);
      for (let i = 0; i < 6; i++) r.applyDirected(A, B, "bonding", rng);
    }
    defaultRel.applyDirected(A, B, "betrayal", new SeededRandom(8));
    harsherRel.applyDirected(A, B, "betrayal", new SeededRandom(8));
    expect(harsherRel.edge(A, B).trust).toBeLessThan(defaultRel.edge(A, B).trust);

    // (b) Zero the betrayal impact in the module ⇒ applying it moves nothing (no hidden constant).
    const inertRel = new RelationshipModel(0.6, withBetrayal({ trust: 0, affinity: 0, threat: 0 }));
    const base = { ...inertRel.edge(A, B) };
    inertRel.applyDirected(A, B, "betrayal", new SeededRandom(9));
    const after = inertRel.edge(A, B);
    expect(after.trust).toBe(base.trust);
    expect(after.affinity).toBe(base.affinity);
    expect(after.threat).toBe(base.threat);
  });
});
