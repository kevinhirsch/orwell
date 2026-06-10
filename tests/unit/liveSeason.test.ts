import { describe, it, expect } from "vitest";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { RelationshipModel } from "../../src/engine/relationships";
import type { Stats } from "../../src/engine/season";
import {
  newLiveSeason, advance, applyDecision, type LiveSeasonState, type SeasonCtx, type BeatEvent,
} from "../../src/engine/liveSeason";

// Roles only — no names (testing rule). A modest house keeps the test fast but still
// exercises jury formation (>2 evictees) and the full beat cycle.
function buildHouse(size: number, seed: number): { active: EntityId[]; ctx: SeasonCtx } {
  const rng = new SeededRandom(seed);
  const active: EntityId[] = [PLAYER, ...Array.from({ length: size - 1 }, (_, i) => npc(i + 1))];
  const stats = new Map<EntityId, Stats>();
  for (const id of active) {
    stats.set(id, { physical: rng.next(), mental: rng.next(), social: rng.next() });
  }
  const rel = new RelationshipModel(0.5);
  for (const a of active) for (const b of active) {
    if (a === b) continue;
    const e = rel.edge(a, b);
    e.trust = rng.next(); e.affinity = rng.next(); e.threat = rng.next(); e.confidence = 0.5;
  }
  return { active, ctx: { player: PLAYER, statsOf: (id) => stats.get(id)!, rel } };
}

/** Drive the live loop to completion with a simple player policy; collect every beat event. */
function playToEnd(s: LiveSeasonState, ctx: SeasonCtx, seed: number): BeatEvent[] {
  const rng = new SeededRandom(seed);
  const events: BeatEvent[] = [];
  for (let guard = 0; guard < 10_000 && !s.finished; guard++) {
    if (s.pending) {
      const p = s.pending;
      if (p.kind === "nominations") events.push(applyDecision(s, { kind: "nominations", choice: [p.options[0]!, p.options[1]!] }, ctx));
      else if (p.kind === "veto-decision") events.push(applyDecision(s, { kind: "veto-decision", use: false }, ctx));
      else if (p.kind === "replacement") events.push(applyDecision(s, { kind: "replacement", replacement: p.options[0]! }, ctx));
      else if (p.kind === "eviction-vote") events.push(applyDecision(s, { kind: "eviction-vote", vote: p.nominees[0] }, ctx));
      else if (p.kind === "finale-statement") events.push(applyDecision(s, { kind: "finale-statement", statement: "thanks" }, ctx));
      else if (p.kind === "finale-answer") events.push(applyDecision(s, { kind: "finale-answer", appeal: p.appeals[0]! }, ctx));
      else if (p.kind === "final-eviction") events.push(applyDecision(s, { kind: "final-eviction", evict: p.options[0]! }, ctx));
      else if (p.kind === "tie-break") events.push(applyDecision(s, { kind: "tie-break", evict: p.nominees[0] }, ctx));
      else if (p.kind === "houseguests-choice") events.push(applyDecision(s, { kind: "houseguests-choice", pick: p.options[0]! }, ctx, rng));
      else if (p.kind === "comp-intent") events.push(applyDecision(s, { kind: "comp-intent", intent: "compete" }, ctx, rng));
      else events.push(applyDecision(s, { kind: "juror-vote", vote: p.finalists[0] }, ctx));
    } else {
      const ev = advance(s, ctx, rng);
      if (ev) events.push(ev);
    }
  }
  return events;
}

describe("live weekly loop (incremental 0011)", () => {
  it("plays a full season down to one winner, appending an event at every beat", () => {
    const { active, ctx } = buildHouse(12, 7);
    const s = newLiveSeason(active);
    const events = playToEnd(s, ctx, 7);

    expect(s.finished).toBe(true);
    expect(s.winner).toBeDefined();
    expect(s.finalTwo).toHaveLength(2);
    expect(s.finalTwo).toContain(s.winner);
    // 12 houseguests → 10 evicted, 2 in the final.
    expect(s.evictionOrder).toHaveLength(10);
    expect(new Set(s.evictionOrder).size).toBe(10); // nobody evicted twice
    expect(s.finalTwo!.every((f) => !s.evictionOrder.includes(f))).toBe(true);
    // Jury is the last 9 evictees; the finale event names a winner.
    expect(s.jury).toHaveLength(9);
    expect(events.some((e) => e.beat === "finale")).toBe(true);
    // Every week produced the full ceremony arc.
    for (const beat of ["hoh-competition", "nominations", "veto-competition", "veto-ceremony", "eviction"] as const) {
      expect(events.filter((e) => e.beat === beat).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("is seed-deterministic: identical inputs ⇒ identical winner and eviction order", () => {
    const a = buildHouse(10, 21); const sa = newLiveSeason(a.active); playToEnd(sa, a.ctx, 21);
    const b = buildHouse(10, 21); const sb = newLiveSeason(b.active); playToEnd(sb, b.ctx, 21);
    expect(sb.winner).toBe(sa.winner);
    expect(sb.evictionOrder).toEqual(sa.evictionOrder);
  });

  it("never produces an illegal replacement nominee (not HOH, original noms kept-or-saved, not veto winner)", () => {
    // Force a save path: drive many seeds and assert every recorded replacement is legal.
    for (const seed of [3, 11, 42, 99]) {
      const { active, ctx } = buildHouse(8, seed);
      const s = newLiveSeason(active);
      const rng = new SeededRandom(seed);
      for (let g = 0; g < 10_000 && !s.finished; g++) {
        if (s.pending) {
          const p = s.pending;
          if (p.kind === "nominations") applyDecision(s, { kind: "nominations", choice: [p.options[0]!, p.options[1]!] }, ctx);
          else if (p.kind === "veto-decision") applyDecision(s, { kind: "veto-decision", use: true, save: p.nominees[0] }, ctx);
          else if (p.kind === "replacement") applyDecision(s, { kind: "replacement", replacement: p.options[0]! }, ctx);
          else if (p.kind === "eviction-vote") applyDecision(s, { kind: "eviction-vote", vote: p.nominees[0] }, ctx);
          else if (p.kind === "finale-statement") applyDecision(s, { kind: "finale-statement", statement: "thanks" }, ctx);
          else if (p.kind === "finale-answer") applyDecision(s, { kind: "finale-answer", appeal: p.appeals[0]! }, ctx);
          else if (p.kind === "final-eviction") applyDecision(s, { kind: "final-eviction", evict: p.options[0]! }, ctx);
          else if (p.kind === "tie-break") applyDecision(s, { kind: "tie-break", evict: p.nominees[0] }, ctx);
          else if (p.kind === "houseguests-choice") applyDecision(s, { kind: "houseguests-choice", pick: p.options[0]! }, ctx, rng);
          else if (p.kind === "comp-intent") applyDecision(s, { kind: "comp-intent", intent: "compete" }, ctx, rng);
          else applyDecision(s, { kind: "juror-vote", vote: p.finalists[0] }, ctx);
        } else {
          if (s.replacement) {
            // A replacement is never the HOH or the veto winner.
            expect(s.replacement).not.toBe(s.hoh);
            expect(s.replacement).not.toBe(s.vetoHolder);
          }
          advance(s, ctx, rng);
        }
      }
      expect(s.finished).toBe(true);
    }
  });

  it("surfaces the player's nomination decision when the player is HOH", () => {
    const { active, ctx } = buildHouse(6, 1);
    const s = newLiveSeason(active);
    s.hoh = PLAYER; s.beat = "nominations";
    const ev = advance(s, ctx, new SeededRandom(1));
    expect(ev).toBeNull();
    expect(s.pending).toEqual({ kind: "nominations", by: PLAYER, options: active.filter((h) => h !== PLAYER), pick: 2 });
    // Illegal picks are rejected.
    expect(() => applyDecision(s, { kind: "nominations", choice: [npc(1), npc(1)] }, ctx)).toThrow();
    // A legal pick advances to the veto competition.
    const noms = applyDecision(s, { kind: "nominations", choice: [npc(1), npc(2)] }, ctx);
    expect(noms.beat).toBe("nominations");
    expect(s.nominees).toEqual([npc(1), npc(2)]);
    expect(s.beat).toBe("veto-competition");
    expect(s.pending).toBeUndefined();
  });

  it("lets the player use the veto and (as HOH) name the replacement", () => {
    const { active, ctx } = buildHouse(6, 2);
    const s = newLiveSeason(active);
    s.hoh = PLAYER; s.nominees = [npc(1), npc(2)]; s.vetoHolder = PLAYER; s.beat = "veto-ceremony";
    expect(advance(s, ctx, new SeededRandom(2))).toBeNull();
    expect(s.pending?.kind).toBe("veto-decision");
    // Use the veto on a nominee → because the player is also HOH, the replacement is the next decision.
    applyDecision(s, { kind: "veto-decision", use: true, save: npc(1) }, ctx);
    expect(s.vetoUsed).toBe(true);
    expect(s.saved).toBe(npc(1));
    expect(s.pending?.kind).toBe("replacement");
    const repl = (s.pending as { options: EntityId[] }).options[0]!;
    applyDecision(s, { kind: "replacement", replacement: repl }, ctx);
    expect(s.finalNominees).toEqual([npc(2), repl]);
    expect(s.beat).toBe("eviction");
  });

  it("surfaces the player's eviction vote when the player is a non-nominated voter", () => {
    const { active, ctx } = buildHouse(6, 3);
    const s = newLiveSeason(active);
    s.hoh = npc(1); s.nominees = [npc(2), npc(3)]; s.finalNominees = [npc(2), npc(3)]; s.beat = "eviction";
    expect(advance(s, ctx, new SeededRandom(3))).toBeNull();
    expect(s.pending).toEqual({ kind: "eviction-vote", by: PLAYER, nominees: [npc(2), npc(3)] });
    const ev = applyDecision(s, { kind: "eviction-vote", vote: npc(2) }, ctx);
    expect(ev.beat).toBe("eviction");
    expect(s.evictionOrder).toContain(ev.participants[0]);
  });

  it("records eviction manner toward the responsible houseguests at each live eviction (0037)", () => {
    const { active, ctx } = buildHouse(6, 5);
    const s = newLiveSeason(active);
    const evictee = npc(2);
    // The evictee TRUSTS the HOH (npc(1)) yet they move against them ⇒ betrayed.
    ctx.rel.edge(evictee, npc(1)).trust = 0.9;
    s.hoh = npc(1); s.nominees = [evictee, npc(3)]; s.finalNominees = [evictee, npc(3)]; s.beat = "eviction";
    // Force the player's vote so npc(2) is the evictee deterministically.
    advance(s, ctx, new SeededRandom(5));
    applyDecision(s, { kind: "eviction-vote", vote: evictee }, ctx);
    expect(s.evictionOrder).toContain(evictee);
    // A manner toward the HOH was recorded (responsible: the HOH put them up).
    expect(s.mannerByEvictee?.[evictee]?.[npc(1)]).toEqual({ betrayed: true });
  });
});

// --- 0037: the live finale sub-loop -------------------------------------------

/**
 * A Final-2 live state with the player as one finalist and a 9-juror panel, plus a controlled
 * relationship model so the finale outcome is legible. No names — roles only (finalist/juror).
 */
function finalTwoState(opts: {
  jurors: number;
  /** Per-juror lean toward finalist A (PLAYER): {trust, affinity, threat}. */
  edgeToA?: (j: EntityId) => { trust: number; affinity: number; threat: number };
  edgeToB?: (j: EntityId) => { trust: number; affinity: number; threat: number };
}): { s: LiveSeasonState; ctx: SeasonCtx; A: EntityId; B: EntityId; jury: EntityId[] } {
  const A = PLAYER;               // the player is finalist A
  const B = npc(99);             // the NPC finalist
  const jury = Array.from({ length: opts.jurors }, (_, i) => npc(i + 1));
  const rel = new RelationshipModel(0.5);
  const stats = new Map<EntityId, Stats>([[A, { physical: 0.5, mental: 0.5, social: 0.5 }], [B, { physical: 0.5, mental: 0.5, social: 0.5 }]]);
  for (const j of jury) {
    const a = opts.edgeToA?.(j) ?? { trust: 0.5, affinity: 0.5, threat: 0.3 };
    const b = opts.edgeToB?.(j) ?? { trust: 0.5, affinity: 0.5, threat: 0.3 };
    Object.assign(rel.edge(j, A), a, { confidence: 0.5 });
    Object.assign(rel.edge(j, B), b, { confidence: 0.5 });
  }
  const s: LiveSeasonState = {
    week: 9, beat: "finale", active: [A, B], vetoUsed: false,
    evictionOrder: [...jury], finished: false,
  };
  return { s, ctx: { player: A, statsOf: (id) => stats.get(id) ?? { physical: 0.5, mental: 0.5, social: 0.5 }, rel }, A, B, jury };
}

/** Drive the finale, answering every player decision with a fixed policy; collect the beats. */
function driveFinale(
  s: LiveSeasonState, ctx: SeasonCtx, rng: SeededRandom,
  policy: { appeal?: import("../../src/engine/jury").FinaleAppeal; jurorVote?: EntityId } = {},
): BeatEvent[] {
  const events: BeatEvent[] = [];
  for (let g = 0; g < 1000 && !s.finished; g++) {
    if (s.pending) {
      const p = s.pending;
      if (p.kind === "finale-statement") events.push(applyDecision(s, { kind: "finale-statement", statement: "hi" }, ctx));
      else if (p.kind === "finale-answer") events.push(applyDecision(s, { kind: "finale-answer", appeal: policy.appeal ?? p.appeals[0]! }, ctx));
      else if (p.kind === "juror-vote") events.push(applyDecision(s, { kind: "juror-vote", vote: policy.jurorVote ?? p.finalists[0] }, ctx));
      else throw new Error(`unexpected pending ${p.kind} in finale`);
    } else {
      const ev = advance(s, ctx, rng);
      if (ev) events.push(ev);
    }
  }
  return events;
}

describe("0037 — live finale sub-loop", () => {
  it("plays as a staged sequence: a statement per finalist, a question per juror, a one-at-a-time reveal", () => {
    const { s, ctx, jury } = finalTwoState({ jurors: 9 });
    const events = driveFinale(s, ctx, new SeededRandom(1));
    // One opening statement per finalist (2).
    const statements = events.filter((e) => e.beat === "finale" && e.content.includes("opening statement"));
    expect(statements).toHaveLength(2);
    // One reveal beat per juror, before the single result beat.
    const reveals = events.filter((e) => e.beat === "finale-reveal");
    expect(reveals).toHaveLength(jury.length);
    const results = events.filter((e) => e.beat === "finale-result");
    expect(results).toHaveLength(1);
    // The reveal beats all precede the result beat.
    const lastReveal = events.lastIndexOf(reveals[reveals.length - 1]!);
    const resultIx = events.indexOf(results[0]!);
    expect(lastReveal).toBeLessThan(resultIx);
    // The game ends with a crowned winner that is one of the two finalists.
    expect(s.finished).toBe(true);
    expect(s.finalTwo).toContain(s.winner);
    expect(s.jury).toHaveLength(9);
  });

  it("stops for the player-finalist to give a statement and to answer EVERY juror question", () => {
    const { s, ctx, jury } = finalTwoState({ jurors: 9 });
    const rng = new SeededRandom(2);
    let statementStops = 0;
    let answerStops = 0;
    for (let g = 0; g < 1000 && !s.finished; g++) {
      if (s.pending?.kind === "finale-statement") { statementStops++; applyDecision(s, { kind: "finale-statement", statement: "x" }, ctx); }
      else if (s.pending?.kind === "finale-answer") { answerStops++; applyDecision(s, { kind: "finale-answer", appeal: s.pending.appeals[0]! }, ctx); }
      else if (s.pending?.kind === "juror-vote") { applyDecision(s, { kind: "juror-vote", vote: s.pending.finalists[0] }, ctx); }
      else advance(s, ctx, rng);
    }
    expect(statementStops).toBe(1);              // the player is a finalist → exactly one statement
    // The player answers every juror question addressed to them (half the panel, by the alternating script).
    const addressedToPlayer = jury.filter((_, i) => i % 2 === 0).length;
    expect(answerStops).toBe(addressedToPlayer);
  });

  it("refuses a finale answer with no legal appeal; the pending decision stands", () => {
    const { s, ctx } = finalTwoState({ jurors: 3 });
    const rng = new SeededRandom(3);
    // Advance to the first player answer.
    while (!s.finished && s.pending?.kind !== "finale-answer") {
      if (s.pending?.kind === "finale-statement") applyDecision(s, { kind: "finale-statement", statement: "x" }, ctx);
      else advance(s, ctx, rng);
    }
    expect(s.pending?.kind).toBe("finale-answer");
    expect(() => applyDecision(s, { kind: "finale-answer", appeal: "not-an-appeal" as never }, ctx)).toThrow();
    expect(s.pending?.kind).toBe("finale-answer"); // unchanged
  });

  it("manner measurably lowers a betrayed juror's vote share for the responsible finalist", () => {
    // Read the first juror's revealed vote across seeds; betrayed should reduce A's share.
    const shareForA = (manner: import("../../src/engine/jury").EvictionManner, runs = 250): number => {
      let aVotes = 0;
      for (let seed = 1; seed <= runs; seed++) {
        const { s, ctx, A, B, jury } = finalTwoState({ jurors: 9 });
        for (const j of jury) {
          Object.assign(ctx.rel.edge(j, A), { trust: 0.5, affinity: 0.5, threat: 0.3 });
          Object.assign(ctx.rel.edge(j, B), { trust: 0.5, affinity: 0.5, threat: 0.3 });
        }
        s.mannerByEvictee = { [jury[0]!]: { [A]: manner } };
        const events = driveFinale(s, ctx, new SeededRandom(seed), { appeal: "connect" });
        const reveal = events.find((e) => e.beat === "finale-reveal" && e.participants[0] === jury[0]);
        if (reveal && reveal.participants[1] === A) aVotes++;
      }
      return aVotes / runs;
    };
    const respected = shareForA({ respected: true });
    const betrayed = shareForA({ betrayed: true });
    expect(betrayed).toBeLessThan(respected);
  });

  it("jury management dominates: a finalist with strong relationships wins the clear majority of runs", () => {
    let aWins = 0;
    const runs = 80;
    for (let seed = 1; seed <= runs; seed++) {
      const { s, ctx, A } = finalTwoState({
        jurors: 9,
        edgeToA: () => ({ trust: 0.85, affinity: 0.85, threat: 0.1 }),
        edgeToB: () => ({ trust: 0.3, affinity: 0.3, threat: 0.45 }),
      });
      // The NPC finalist B plays optimally (auto bestAppeal); the player A makes its WEAKEST legal
      // appeal every answer — jury management must still carry A.
      const events = driveFinale(s, ctx, new SeededRandom(seed), { appeal: "discredit-rival" });
      if (s.winner === A) aWins++;
      expect(events.some((e) => e.beat === "finale-result")).toBe(true);
    }
    expect(aWins / runs).toBeGreaterThan(0.85);
  });

  it("the player on the jury casts their own vote; an illegal vote is refused; the others are engine-decided", () => {
    // Player is a JUROR here (not a finalist): two NPC finalists, player among the panel.
    const A = npc(50), B = npc(51);
    const jury = [PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5), npc(6), npc(7), npc(8)];
    const rel = new RelationshipModel(0.5);
    for (const j of jury) { Object.assign(rel.edge(j, A), { trust: 0.5, affinity: 0.5, threat: 0.3 }); Object.assign(rel.edge(j, B), { trust: 0.5, affinity: 0.5, threat: 0.3 }); }
    const s: LiveSeasonState = { week: 9, beat: "finale", active: [A, B], vetoUsed: false, evictionOrder: [...jury], finished: false };
    const ctx: SeasonCtx = { player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel };
    const rng = new SeededRandom(7);
    // Advance to the player's juror vote (no statements/answers since the player isn't a finalist).
    while (!s.finished && s.pending?.kind !== "juror-vote") advance(s, ctx, rng);
    expect(s.pending?.kind).toBe("juror-vote");
    // An illegal vote (not a finalist) is refused; the pending decision stands.
    expect(() => applyDecision(s, { kind: "juror-vote", vote: npc(1) }, ctx)).toThrow();
    expect(s.pending?.kind).toBe("juror-vote");
    // A legal vote is recorded; the loop then decides the other 8 and reveals.
    applyDecision(s, { kind: "juror-vote", vote: A }, ctx);
    while (!s.finished) advance(s, ctx, rng);
    expect(s.finished).toBe(true);
    expect([A, B]).toContain(s.winner);
    // The player's own recorded vote was honored.
    expect(s.finale!.votes![PLAYER]).toBe(A);
  });

  it("is seed-deterministic: same seed + same choices ⇒ identical reveals and winner", () => {
    const run = (): { winner: EntityId | undefined; reveals: string[] } => {
      const { s, ctx } = finalTwoState({ jurors: 9, edgeToA: () => ({ trust: 0.6, affinity: 0.55, threat: 0.2 }) });
      const events = driveFinale(s, ctx, new SeededRandom(42), { appeal: "own-game" });
      return { winner: s.winner, reveals: events.filter((e) => e.beat === "finale-reveal").map((e) => `${e.participants[0]}->${e.participants[1]}`) };
    };
    const a = run();
    const b = run();
    expect(b.winner).toBe(a.winner);
    expect(b.reveals).toEqual(a.reveals);
  });

  it("the finale state serializes and resumes mid-question after a restart (0030)", () => {
    const { s, ctx } = finalTwoState({ jurors: 9 });
    const rng = new SeededRandom(11);
    // Advance partway: through statements and a couple of player answers.
    let answersDone = 0;
    while (!s.finished && answersDone < 2) {
      if (s.pending?.kind === "finale-statement") applyDecision(s, { kind: "finale-statement", statement: "x" }, ctx);
      else if (s.pending?.kind === "finale-answer") { applyDecision(s, { kind: "finale-answer", appeal: "mend" }, ctx); answersDone++; }
      else advance(s, ctx, rng);
    }
    // Snapshot via the same JSON round-trip the durable save uses.
    const resumed: LiveSeasonState = JSON.parse(JSON.stringify(s));
    expect(resumed.finale?.stage).toBe(s.finale?.stage);
    expect(resumed.finale?.questionIx).toBe(s.finale?.questionIx);
    expect(resumed.finale?.statementIx).toBe(s.finale?.statementIx);
    expect(resumed.finale?.appeals).toEqual(s.finale?.appeals);
    // The resumed state finishes the finale identically to the original (same continuation seed).
    const finish = (st: LiveSeasonState, r: SeededRandom): EntityId | undefined => {
      for (let g = 0; g < 1000 && !st.finished; g++) {
        if (st.pending?.kind === "finale-answer") applyDecision(st, { kind: "finale-answer", appeal: "mend" }, ctx);
        else if (st.pending?.kind === "juror-vote") applyDecision(st, { kind: "juror-vote", vote: st.pending.finalists[0] }, ctx);
        else if (st.pending?.kind === "finale-statement") applyDecision(st, { kind: "finale-statement", statement: "x" }, ctx);
        else advance(st, ctx, r);
      }
      return st.winner;
    };
    const wOriginal = finish(s, new SeededRandom(11));
    const wResumed = finish(resumed, new SeededRandom(11));
    expect(wResumed).toBe(wOriginal);
  });
});
