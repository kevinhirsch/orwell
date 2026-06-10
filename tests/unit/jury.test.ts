import { describe, it, expect } from "vitest";
import { juryLean, castJuryVote, tallyJuryVote, runFinale, JURY_WEIGHTS, appealEffect, bestAppeal, finalePerformance, FINALE_APPEALS } from "../../src/engine/jury";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { npc } from "../../src/domain/ids";

const A = npc(20);
const B = npc(21);
const neutral = { trust: 0.5, affinity: 0.5, threat: 0.2 };

function voteRateForA(leanA: number, leanB: number, perfA = 0.5, perfB = 0.5, runs = 400): number {
  let a = 0;
  for (let s = 1; s <= runs; s++) {
    const v = castJuryVote([A, B], (f) => (f === A ? leanA : leanB), (f) => (f === A ? perfA : perfB), new SeededRandom(s));
    if (v === A) a++;
  }
  return a / runs;
}

describe("0014 — jury management drives the lean", () => {
  it("blindsided/betrayed/disrespected lowers the lean; respected raises it", () => {
    const base = juryLean(neutral, {});
    expect(juryLean(neutral, { respected: true })).toBeGreaterThan(base);
    expect(juryLean(neutral, { blindsided: true })).toBeLessThan(base);
    expect(juryLean(neutral, { betrayed: true })).toBeLessThan(juryLean(neutral, { blindsided: true }));
    expect(juryLean(neutral, { disrespected: true })).toBeLessThan(base);
  });

  it("a blindsided juror is less likely to vote for that finalist (vs respected)", () => {
    const respected = voteRateForA(juryLean(neutral, { respected: true }), juryLean(neutral, {}));
    const blindsided = voteRateForA(juryLean(neutral, { blindsided: true }), juryLean(neutral, {}));
    expect(blindsided).toBeLessThan(respected);
  });
});

describe("0014 — jury management dominates; finale sways the margin", () => {
  it("a strongly-managed finalist wins the clear majority of runs", () => {
    // A has strong jury relationships; B weak. A should win a strong majority.
    const leanA = juryLean({ trust: 0.85, affinity: 0.85, threat: 0.1 }, { respected: true });
    const leanB = juryLean({ trust: 0.35, affinity: 0.35, threat: 0.4 }, {});
    expect(voteRateForA(leanA, leanB)).toBeGreaterThan(0.85);
  });

  it("a strong finale rarely overturns a clear lead", () => {
    // A holds a clear lead; B brings the best possible finale, A the worst. A still wins almost always.
    const leanA = juryLean({ trust: 0.85, affinity: 0.85, threat: 0.1 }, { respected: true });
    const leanB = juryLean({ trust: 0.35, affinity: 0.35, threat: 0.4 }, {});
    expect(voteRateForA(leanA, leanB, 0.0, 1.0)).toBeGreaterThan(0.85);
  });

  it("the finale does sway close jurors (both outcomes occur)", () => {
    // Near-tied leans: the finale flips the result depending on performance + seed.
    const lean = juryLean(neutral, {});
    const aFavoured = voteRateForA(lean, lean, 1.0, 0.0);
    const bFavoured = voteRateForA(lean, lean, 0.0, 1.0);
    expect(aFavoured).toBeGreaterThan(bFavoured);
    expect(aFavoured).toBeGreaterThan(0.5);
    expect(bFavoured).toBeLessThan(0.5);
  });
});

describe("0014 — engine-decided tally with last-juror tie-break", () => {
  const jurors = [npc(1), npc(2), npc(3)];
  const evictionOrder = [npc(1), npc(2), npc(3)]; // npc(3) last-evicted

  it("most votes wins", () => {
    // All jurors lean A.
    const winner = tallyJuryVote(jurors, [A, B], () => 0, () => 0.5, evictionOrder, new SeededRandom(1),
      { relationship: 1, manner: 1, finale: 0 });
    // finale weight 0 + equal leans → deterministic A (>= tie goes to finalists[0]).
    expect(winner).toBe(A);
  });

  it("a 1-1-1 split tie resolves via the last-evicted juror", () => {
    // Make each juror's lean deterministic: npc(1)->A, npc(2)->B, npc(3)->A (last juror) => A wins 2-1.
    const leanOf = (j: string, f: string): number => {
      if (j === npc(1)) return f === A ? 1 : 0;
      if (j === npc(2)) return f === B ? 1 : 0;
      return f === A ? 1 : 0; // npc(3), last-evicted
    };
    const w = { relationship: 1, manner: 1, finale: 0 };
    expect(tallyJuryVote(jurors, [A, B], leanOf, () => 0, evictionOrder, new SeededRandom(1), w)).toBe(A);

    // Now a real 1-1 tie with two jurors; last-evicted (npc(2)) leans B → B wins.
    const two = [npc(1), npc(2)];
    const leanTie = (j: string, f: string): number => (j === npc(1) ? (f === A ? 1 : 0) : (f === B ? 1 : 0));
    expect(tallyJuryVote(two, [A, B], leanTie, () => 0, [npc(1), npc(2)], new SeededRandom(1), w)).toBe(B);
  });

  it("the tally is engine-deterministic and independent of any voicing", () => {
    const leanOf = (_j: string, f: string): number => (f === A ? 0.9 : 0.2);
    const a = tallyJuryVote(jurors, [A, B], leanOf, () => 0.5, evictionOrder, new SeededRandom(7));
    const b = tallyJuryVote(jurors, [A, B], leanOf, () => 0.5, evictionOrder, new SeededRandom(7));
    expect(a).toBe(b); // same seed + inputs → same winner; narration plays no part
  });
});

describe("0014 — Final 2 choreography", () => {
  it("one statement per finalist, EACH juror questions BOTH finalists, one-at-a-time reveal", () => {
    const jury = [npc(1), npc(2), npc(3), npc(4), npc(5), npc(6), npc(7), npc(8), npc(9)];
    const script = runFinale([A, B], jury);
    expect(script.statements).toEqual([A, B]);
    // 18 Q&A: every juror questions both finalists, so no (finalist, juror) pair is left unanswered (A6).
    expect(script.questions).toHaveLength(jury.length * 2);
    for (const j of jury) {
      const asked = script.questions.filter((q) => q.juror === j).map((q) => q.finalist).sort();
      expect(asked).toEqual([A, B].sort());
    }
    expect(script.revealOrder).toEqual(jury);
  });
});

describe("0037 — engine-legible finale appeals (anti-sycophancy)", () => {
  it("every appeal scores within [0,1] for any juror state", () => {
    for (const a of FINALE_APPEALS) {
      for (const manner of [{}, { betrayed: true }, { blindsided: true }, { respected: true }]) {
        for (const affinity of [0, 0.5, 1]) {
          const e = appealEffect(a, { trust: 0.5, affinity, threat: 0.3 }, manner);
          expect(e).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("mend lands on a grievance and is wasted without one", () => {
    expect(appealEffect("mend", neutral, { betrayed: true })).toBeGreaterThan(appealEffect("mend", neutral, {}));
    expect(appealEffect("mend", neutral, { blindsided: true })).toBeGreaterThan(0.6);
  });

  it("connect scales with affinity; own-game backfires on the betrayed", () => {
    expect(appealEffect("connect", { trust: 0.5, affinity: 0.9, threat: 0.2 }, {}))
      .toBeGreaterThan(appealEffect("connect", { trust: 0.5, affinity: 0.1, threat: 0.2 }, {}));
    expect(appealEffect("own-game", neutral, { betrayed: true })).toBeLessThan(appealEffect("own-game", neutral, {}));
  });

  it("bestAppeal is a deterministic argmax that picks mend for a grievance juror", () => {
    expect(bestAppeal(neutral, { betrayed: true })).toBe("mend");
    // Stable across calls (pure).
    expect(bestAppeal({ trust: 0.5, affinity: 0.95, threat: 0.1 }, {}))
      .toBe(bestAppeal({ trust: 0.5, affinity: 0.95, threat: 0.1 }, {}));
  });

  it("the finale sway is BOUNDED: a perfect finale cannot overturn a clear relationship lead", () => {
    // B holds a clear accumulated lead; A plays a perfect finale, B a weak one.
    const leanA = juryLean(neutral, {});
    const leanB = juryLean(neutral, {}) + 1.0; // clear lead for B
    const perfA = 1.0, perfB = 0.0;
    let aWins = 0;
    for (let s = 1; s <= 400; s++) {
      const v = castJuryVote([A, B], (f) => (f === A ? leanA : leanB), (f) => (f === A ? perfA : perfB), new SeededRandom(s));
      if (v === A) aWins++;
    }
    // finale weight (0.3) is far below a 1.0 lead → A's perfect finale never flips it.
    expect(aWins).toBe(0);
  });

  it("the finale DOES sway a close juror", () => {
    const lean = juryLean(neutral, {});
    let aWins = 0;
    for (let s = 1; s <= 400; s++) {
      const v = castJuryVote([A, B], () => lean, (f) => (f === A ? 1.0 : 0.0), new SeededRandom(s));
      if (v === A) aWins++;
    }
    // Even split on relationship + A's strong finale → A wins clearly more than half.
    expect(aWins).toBeGreaterThan(260);
  });

  it("finalePerformance averages appeal qualities", () => {
    const parts = FINALE_APPEALS.map((a) => ({ quality: appealEffect(a, neutral, { betrayed: true }) }));
    const p = finalePerformance(parts);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
