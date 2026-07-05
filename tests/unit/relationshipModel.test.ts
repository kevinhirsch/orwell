import { describe, it, expect } from "vitest";
import {
  RelationshipModel, relationshipLabel, NEUTRAL_BOND, CONFIDENCE_KNOWLEDGE,
} from "../../src/engine/relationships";
import { foldHiddenImpact } from "../../src/engine/consequence";
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

  it("PERSIST-3: load() sanitizes an already-corrupted null/NaN field to baseline instead of propagating it", () => {
    const rel = new RelationshipModel(0.6);
    // Simulates a save from before the PERSIST-2 clamp01 NaN guard (or any future bug that slips
    // past it): JSON round-trips a NaN to `null`. A bare pass-through would let `null` silently
    // coerce to `0` on the next arithmetic read — an undocumented reset to the edge's floor value.
    rel.load([
      { from: A, to: B, trust: null as unknown as number, affinity: 0.4, threat: 0.2, alignment: 0.1, confidence: 0.3 },
    ]);
    const edge = rel.edge(A, B);
    for (const v of Object.values(edge)) expect(Number.isFinite(v)).toBe(true);
    expect(edge.affinity).toBe(0.4); // untouched fields pass through exactly
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

describe("witnessed scenes move each witness by THEIR OWN beliefs, never uniformly (audit 2026-06-18)", () => {
  // Roles: an ACTOR bonds with a PARTNER while three BYSTANDERS look on — one who likes the
  // partner, one who dislikes them, one neutral. The partner takes the full bond; the bystanders
  // react small + individuated by structural balance. Never a uniform group step.
  const ACTOR = npc(10), PARTNER = npc(11);
  const FRIEND_OF_PARTNER = npc(12), RIVAL_OF_PARTNER = npc(13), NEUTRAL = npc(14);

  function setup() {
    const rel = new RelationshipModel(0.6);
    rel.edge(FRIEND_OF_PARTNER, PARTNER).affinity = 0.75; // already close to the partner
    rel.edge(RIVAL_OF_PARTNER, PARTNER).affinity = 0.05;  // already cold on the partner
    // NEUTRAL keeps baseline affinity toward the partner.
    return rel;
  }

  it("the partner takes the full bond; every bystander moves far less (a private bond never bonds the room)", () => {
    const rel = setup();
    const witnesses = [ACTOR, PARTNER, FRIEND_OF_PARTNER, RIVAL_OF_PARTNER, NEUTRAL];
    const before = (h: ReturnType<typeof npc>) => rel.edge(h, ACTOR).affinity;
    const [p0, f0, r0, n0] = [PARTNER, FRIEND_OF_PARTNER, RIVAL_OF_PARTNER, NEUTRAL].map(before);
    foldHiddenImpact(rel, new SeededRandom(1), ACTOR, witnesses, "bonding",
      [PARTNER], Number.POSITIVE_INFINITY, [FRIEND_OF_PARTNER, RIVAL_OF_PARTNER, NEUTRAL]);
    const dPartner = rel.edge(PARTNER, ACTOR).affinity - p0;
    const dFriend = rel.edge(FRIEND_OF_PARTNER, ACTOR).affinity - f0;
    const dRival = rel.edge(RIVAL_OF_PARTNER, ACTOR).affinity - r0;
    const dNeutral = rel.edge(NEUTRAL, ACTOR).affinity - n0;
    // the partner bonds for real; every bystander moves strictly less than the partner
    expect(dPartner).toBeGreaterThan(0.05);
    for (const d of [dFriend, dRival, dNeutral]) expect(Math.abs(d)).toBeLessThan(dPartner);
  });

  it("bystanders move by their own beliefs: friend-of-partner warms, rival cools, neutral barely moves — NOT uniform", () => {
    const rel = setup();
    const witnesses = [ACTOR, PARTNER, FRIEND_OF_PARTNER, RIVAL_OF_PARTNER, NEUTRAL];
    const fAff0 = rel.edge(FRIEND_OF_PARTNER, ACTOR).affinity;
    const rAff0 = rel.edge(RIVAL_OF_PARTNER, ACTOR).affinity;
    const rThreat0 = rel.edge(RIVAL_OF_PARTNER, ACTOR).threat;
    const nAff0 = rel.edge(NEUTRAL, ACTOR).affinity;
    foldHiddenImpact(rel, new SeededRandom(1), ACTOR, witnesses, "bonding",
      [PARTNER], Number.POSITIVE_INFINITY, [FRIEND_OF_PARTNER, RIVAL_OF_PARTNER, NEUTRAL]);
    const dFriend = rel.edge(FRIEND_OF_PARTNER, ACTOR).affinity - fAff0;
    const dRival = rel.edge(RIVAL_OF_PARTNER, ACTOR).affinity - rAff0;
    const dRivalThreat = rel.edge(RIVAL_OF_PARTNER, ACTOR).threat - rThreat0;
    const dNeutral = rel.edge(NEUTRAL, ACTOR).affinity - nAff0;
    // someone who likes the partner warms to the actor; someone who dislikes the partner cools and
    // grows wary; a neutral bystander is barely moved — and the three are NOT the same number.
    expect(dFriend).toBeGreaterThan(0);
    expect(dRival).toBeLessThan(0);
    expect(dRivalThreat).toBeGreaterThan(0);
    expect(Math.abs(dNeutral)).toBeLessThan(Math.abs(dFriend));
    expect(dFriend).not.toBeCloseTo(dRival, 3); // never a uniform group move
  });
});
