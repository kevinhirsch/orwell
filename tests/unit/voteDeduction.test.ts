import { describe, it, expect } from "vitest";
import { deduceEvictionVoters, deductionConfidence } from "../../src/engine/voteDeduction";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0110 — vote deduction (process of elimination). The evictee deduces who moved against them
 * from the PUBLIC count + eligible pool + their OWN reads — a belief (0002) that CAN be wrong. It never
 * reads the true ballot. HARD rule: roles only.
 */

const EVICTEE = npc(1);

/** A relationship model where the evictee reads each listed houseguest at the given threat/trust. */
function reads(rows: Array<{ id: EntityId; threat: number; trust: number }>): RelationshipModel {
  const rel = new RelationshipModel(0.5);
  for (const r of rows) {
    const e = rel.edge(EVICTEE, r.id);
    e.threat = r.threat;
    e.trust = r.trust;
  }
  return rel;
}

describe("0110 — deduceEvictionVoters (process of elimination)", () => {
  it("a unanimous vote is fully constrained: everyone is believed, confidence 1", () => {
    const pool = [npc(2), npc(3), npc(4)];
    const rel = reads(pool.map((id) => ({ id, threat: 0.5, trust: 0.5 })));
    const d = deduceEvictionVoters(EVICTEE, pool, pool.length, rel, new SeededRandom(1));
    expect([...d.believed].sort()).toEqual([...pool].sort());
    expect(d.confidence).toBe(1);
  });

  it("a zero-vote count believes no one, confidence 1", () => {
    const pool = [npc(2), npc(3)];
    const d = deduceEvictionVoters(EVICTEE, pool, 0, reads([]), new SeededRandom(1));
    expect(d.believed).toEqual([]);
    expect(d.confidence).toBe(1);
  });

  it("a clearly-constrained vote is deduced correctly with HIGH confidence", () => {
    // Two obvious rivals (high threat, low trust) + two loyalists (low threat, high trust); count 2.
    const rivals = [npc(2), npc(3)];
    const loyalists = [npc(4), npc(5)];
    const rel = reads([
      ...rivals.map((id) => ({ id, threat: 0.9, trust: 0.1 })),
      ...loyalists.map((id) => ({ id, threat: 0.1, trust: 0.9 })),
    ]);
    const d = deduceEvictionVoters(EVICTEE, [...rivals, ...loyalists], 2, rel, new SeededRandom(3));
    expect([...d.believed].sort()).toEqual([...rivals].sort()); // the two rivals, correctly
    expect(d.confidence).toBeGreaterThan(0.8);
    // A trusted loyalist is NOT believed — an undeducible (low-suspicion) vote earns no grudge.
    for (const l of loyalists) expect(d.believed).not.toContain(l);
  });

  it("a count that FORCES a loyalist to have flipped believes a trusted houseguest (betrayal-grade)", () => {
    // Only one obvious rival, but the count is 2 → one trusted loyalist MUST be in the believed set.
    const rival = npc(2);
    const loyalists = [npc(3), npc(4)];
    const rel = reads([
      { id: rival, threat: 0.9, trust: 0.1 },
      { id: loyalists[0]!, threat: 0.1, trust: 0.85 },
      { id: loyalists[1]!, threat: 0.1, trust: 0.9 },
    ]);
    const d = deduceEvictionVoters(EVICTEE, [rival, ...loyalists], 2, rel, new SeededRandom(4));
    expect(d.believed).toContain(rival);
    // A trusted loyalist is forced into the belief — the raw material for a betrayal-grade jury grudge.
    expect(d.believed.some((v) => loyalists.includes(v))).toBe(true);
  });

  it("an ambiguous vote is LOW confidence and can misattribute across seeds", () => {
    // Four near-identical reads; count 1 → no clear defector, so the belief wobbles with the seed.
    const pool = [npc(2), npc(3), npc(4), npc(5)];
    const rel = reads(pool.map((id) => ({ id, threat: 0.5, trust: 0.5 })));
    const picks = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const d = deduceEvictionVoters(EVICTEE, pool, 1, rel, new SeededRandom(seed));
      expect(d.confidence).toBeLessThan(0.3);       // ambiguous ⇒ low confidence
      picks.add(d.believed[0]!);
    }
    expect(picks.size).toBeGreaterThan(1);           // the deduction misattributes differently by seed
  });

  it("deductionConfidence is 1 when fully constrained and rises with the cut-line margin", () => {
    expect(deductionConfidence([0.9, 0.8], 2)).toBe(1);      // unanimous
    expect(deductionConfidence([0.9, 0.8], 0)).toBe(1);      // no defectors
    const clear = deductionConfidence([0.9, 0.1, 0.05], 1);  // big gap after the 1st
    const murky = deductionConfidence([0.55, 0.5, 0.45], 1); // small gap
    expect(clear).toBeGreaterThan(murky);
  });
});

describe("0110 — the live adapter folds it in without crashing (deterministic)", () => {
  it("a full season plays to a winner with vote deduction ENABLED, reproducibly", () => {
    const play = (seed: number): string | null => {
      const s = new GameSessionAdapter();
      s.createCharacter({ playerName: "P", seed });
      s.setVoteDeductionEnabled(true);           // fold the jury grudge on the deduced belief
      const fin = s.advanceToFinale();           // the engine's own deterministic fast-forward
      expect(fin.finished).toBe(true);
      return fin.winnerName;
    };
    const first = play(9);
    expect(first).toBeTruthy();      // the season completes with deduction on (no crash)
    expect(play(9)).toBe(first);     // …and reproduces (deterministic)
  });
});
