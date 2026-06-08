import { describe, it, expect } from "vitest";
import {
  RelationshipModel, relationshipLabel, NEUTRAL_BOND, CONFIDENCE_KNOWLEDGE,
} from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";

const A = npc(1);
const B = npc(2);

describe("0017 — relationship model (decision 0002)", () => {
  it("edges are directed and become asymmetric under one-sided investment", () => {
    const rel = new RelationshipModel(0.6);
    const rng = new SeededRandom(1);
    for (let i = 0; i < 6; i++) rel.applyDirected(A, B, "bonding", rng);
    expect(rel.bondStrength(A, B)).toBeGreaterThan(rel.bondStrength(B, A) + 0.1);
  });

  it("a read firms up from suspicion to knowledge as data accrues", () => {
    const rel = new RelationshipModel(0.6);
    rel.applyDirected(A, B, "gossip", new SeededRandom(1));
    expect(rel.read(A, B).kind).toBe("suspicion");
    expect(rel.read(A, B).confidence).toBeLessThan(CONFIDENCE_KNOWLEDGE);
    const rng = new SeededRandom(2);
    for (let i = 0; i < 10; i++) rel.apply(A, B, "strategy", rng);
    expect(rel.read(A, B).kind).toBe("knowledge");
  });

  it("a witnessed betrayal sharply drops trust and raises threat in one step", () => {
    const rel = new RelationshipModel(0.6);
    const rng = new SeededRandom(3);
    for (let i = 0; i < 6; i++) rel.apply(A, B, "bonding", rng);
    const trustBefore = rel.edge(A, B).trust;
    rel.applyDirected(A, B, "betrayal", new SeededRandom(4));
    expect(rel.edge(A, B).trust).toBeLessThan(trustBefore - 0.2);
    expect(rel.edge(A, B).threat).toBeGreaterThan(0.1);
  });

  it("a neglected edge decays toward baseline", () => {
    const rel = new RelationshipModel(0.6);
    const rng = new SeededRandom(5);
    for (let i = 0; i < 6; i++) rel.apply(A, B, "bonding", rng);
    const before = rel.bondStrength(A, B);
    for (let i = 0; i < 12; i++) rel.decay(0.2);
    const after = rel.bondStrength(A, B);
    expect(after).toBeLessThan(before);
    expect(Math.abs(after - NEUTRAL_BOND)).toBeLessThan(Math.abs(before - NEUTRAL_BOND));
  });

  it("serialize exposes graded signals and stores NO ally/enemy label", () => {
    const rel = new RelationshipModel(0.6);
    rel.apply(A, B, "strategy", new SeededRandom(6));
    const json = JSON.stringify(rel.serialize());
    expect(json).toMatch(/"trust"/);
    expect(json).toMatch(/"threat"/);
    expect(/"(ally|enemy|bestFriend|label)"\s*:/i.test(json)).toBe(false);
  });

  it("the same signals read differently under different dispositions (on the spot)", () => {
    const s = { trust: 0.5, affinity: 0.5, threat: 0.5, alignment: 0.3, confidence: 0.5 };
    expect(relationshipLabel(s, "clash")).toBe("enemy");
    expect(relationshipLabel(s, "bond")).toBe("ally");
  });

  it("chooseStrongestBond picks the strongest bond and bounded variance never flips a clear lead", () => {
    const rel = new RelationshipModel(0.6);
    const rng = new SeededRandom(7);
    for (let i = 0; i < 8; i++) rel.applyDirected(A, npc(3), "alliance", rng);
    for (let s = 1; s <= 20; s++) {
      expect(rel.chooseStrongestBond(A, [npc(2), npc(3), npc(4)], new SeededRandom(s))).toBe(npc(3));
    }
  });
});
