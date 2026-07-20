import { describe, it, expect } from "vitest";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { RelationshipModel } from "../../src/engine/relationships";
import type { Stats } from "../../src/engine/season";

// The STAGED engine (current liveSeason — visible elimination rounds, PR #395).
import {
  newLiveSeason as newStaged, advance as advanceStaged, applyDecision as applyStaged,
  type LiveSeasonState as StagedState, type SeasonCtx as StagedCtx, type BeatEvent as StagedBeat,
} from "../../src/engine/liveSeason";

// The PRE-#395 NON-STAGED engine, captured verbatim (git cc9e1a5) as the authoritative baseline.
// Every shared dependency it imports is byte-identical between the baseline and HEAD (only
// competitionOutcome.ts changed, and the baseline uses only its UNCHANGED `resolveCompetition` /
// `CompetitionIntents`), so this fixture is the true single-shot reference trajectory.
import {
  newLiveSeason as newBaseline, advance as advanceBaseline, applyDecision as applyBaseline,
  type LiveSeasonState as BaselineState, type SeasonCtx as BaselineCtx, type BeatEvent as BaselineBeat,
} from "./fixtures/liveSeasonBaseline";

/**
 * PR #395 jury-aggregate regression — the FULL-TRAJECTORY outcome-neutrality litmus.
 *
 * The staged (endurance-style) competition must be a pure PRESENTATION re-telling of what the
 * non-staged engine already does: for any seed, the ENTIRE game trajectory — every HOH/veto winner,
 * every nomination, every eviction, the eviction ORDER, and who reaches jury — must be byte-identical
 * to the pre-#395 (non-staged) baseline. Only the presentation (visible elimination rounds) is new.
 *
 * This is the real litmus the heavy `jury-aggregate` CI band depends on: if the trajectory is
 * byte-identical to the baseline (which passed the band), the band passes again. We prove it here
 * WITHOUT the heavy sims by playing short-but-complete seeded games both ways and asserting the
 * trajectories match exactly. HARD rule: roles only — no names.
 */

/** A seeded house: balanced stats + a seeded relationship graph. IDENTICAL inputs feed both engines. */
function buildHouse(size: number, seed: number): { active: EntityId[]; statsOf: (id: EntityId) => Stats; rel: () => RelationshipModel } {
  const rng = new SeededRandom(seed);
  const active: EntityId[] = [PLAYER, ...Array.from({ length: size - 1 }, (_, i) => npc(i + 1))];
  const stats = new Map<EntityId, Stats>();
  for (const id of active) stats.set(id, { physical: rng.next(), mental: rng.next(), social: rng.next() });
  // Snapshot the seeded edge values so each engine gets its OWN fresh, identical RelationshipModel
  // (the model mutates as the loop folds consequence — they must not share one instance).
  const edges = new Map<string, { trust: number; affinity: number; threat: number }>();
  for (const a of active) for (const b of active) {
    if (a === b) continue;
    edges.set(`${a}|${b}`, { trust: rng.next(), affinity: rng.next(), threat: rng.next() });
  }
  const freshRel = (): RelationshipModel => {
    const rel = new RelationshipModel(0.5);
    for (const a of active) for (const b of active) {
      if (a === b) continue;
      const e = rel.edge(a, b);
      const seeded = edges.get(`${a}|${b}`)!;
      e.trust = seeded.trust; e.affinity = seeded.affinity; e.threat = seeded.threat; e.confidence = 0.5;
    }
    return rel;
  };
  return { active, statsOf: (id) => stats.get(id)!, rel: freshRel };
}

/** The trajectory we hold byte-identical: the ceremony-defining beat events + the endgame facts. */
interface Trajectory {
  /** Every CEREMONY-defining beat in order: the winners, the nominations, the evictions, the crown. */
  ceremonies: string[];
  /** The full eviction ORDER (ids, earliest-out first). */
  evictionOrder: EntityId[];
  /** The crowned winner + the Final 2. */
  winner: EntityId | undefined;
  finalTwo: EntityId[] | undefined;
}

/** The beats that DEFINE the trajectory (a comp crown, a nomination, an eviction) — NOT the staged-only
 *  `comp-elimination` drops (presentation), nor the per-vote reveal choreography (it is identical both ways). */
const TRAJECTORY_BEATS = new Set([
  "hoh-competition", "veto-competition", "nominations", "veto-ceremony",
  "eviction", "final-eviction", "finale-result",
]);

function record(traj: Trajectory, ev: { beat: string; content: string } | null): void {
  if (ev && TRAJECTORY_BEATS.has(ev.beat)) traj.ceremonies.push(`${ev.beat}: ${ev.content}`);
}

/**
 * Drive the STAGED engine to completion with a fixed passive policy (compete every comp round,
 * first legal option everywhere). The staged comp issues one `comp-round` per round the player
 * survives — each answered "compete", identically to the baseline's single `comp-intent`.
 */
function playStaged(active: EntityId[], ctx: StagedCtx, seed: number): Trajectory {
  const s: StagedState = newStaged(active);
  const rng = new SeededRandom(seed);
  const traj: Trajectory = { ceremonies: [], evictionOrder: [], winner: undefined, finalTwo: undefined };
  for (let guard = 0; guard < 20_000 && !s.finished; guard++) {
    if (s.pending) {
      const p = s.pending;
      let ev: StagedBeat | null = null;
      if (p.kind === "comp-round" || p.kind === "comp-intent") ev = applyStaged(s, { kind: p.kind, intent: "compete" }, ctx, rng);
      else if (p.kind === "nominations") ev = applyStaged(s, { kind: "nominations", choice: [p.options[0]!, p.options[1]!] }, ctx);
      else if (p.kind === "veto-decision") ev = applyStaged(s, { kind: "veto-decision", use: false }, ctx);
      else if (p.kind === "replacement") ev = applyStaged(s, { kind: "replacement", replacement: p.options[0]! }, ctx);
      else if (p.kind === "eviction-vote") ev = applyStaged(s, { kind: "eviction-vote", vote: p.nominees[0] }, ctx);
      else if (p.kind === "tie-break") ev = applyStaged(s, { kind: "tie-break", evict: p.nominees[0] }, ctx);
      else if (p.kind === "final-eviction") ev = applyStaged(s, { kind: "final-eviction", evict: p.options[0]! }, ctx);
      else if (p.kind === "houseguests-choice") ev = applyStaged(s, { kind: "houseguests-choice", pick: p.options[0]! }, ctx, rng);
      else if (p.kind === "goodbye-message") ev = applyStaged(s, { kind: "goodbye-message", tone: p.tones[0]! }, ctx);
      else if (p.kind === "exit-interview") ev = applyStaged(s, { kind: "exit-interview", stance: p.stances[0]! }, ctx);
      else if (p.kind === "finale-statement") ev = applyStaged(s, { kind: "finale-statement", statement: "" }, ctx);
      else if (p.kind === "finale-answer") ev = applyStaged(s, { kind: "finale-answer", appeal: p.appeals[0]! }, ctx);
      else if (p.kind === "juror-question") ev = applyStaged(s, { kind: "juror-question", question: "" }, ctx);
      else if (p.kind === "juror-vote") ev = applyStaged(s, { kind: "juror-vote", vote: p.finalists[0] }, ctx);
      else throw new Error(`staged: unhandled pending ${p.kind}`);
      record(traj, ev);
    } else {
      record(traj, advanceStaged(s, ctx, rng));
    }
  }
  traj.evictionOrder = [...s.evictionOrder];
  traj.winner = s.winner;
  traj.finalTwo = s.finalTwo ? [...s.finalTwo] : undefined;
  return traj;
}

/** Drive the NON-STAGED baseline to completion with the SAME passive policy (its comp pending is `comp-intent`). */
function playBaseline(active: EntityId[], ctx: BaselineCtx, seed: number): Trajectory {
  const s: BaselineState = newBaseline(active);
  const rng = new SeededRandom(seed);
  const traj: Trajectory = { ceremonies: [], evictionOrder: [], winner: undefined, finalTwo: undefined };
  for (let guard = 0; guard < 20_000 && !s.finished; guard++) {
    if (s.pending) {
      const p = s.pending;
      let ev: BaselineBeat | null = null;
      if (p.kind === "comp-intent") ev = applyBaseline(s, { kind: "comp-intent", intent: "compete" }, ctx, rng);
      else if (p.kind === "nominations") ev = applyBaseline(s, { kind: "nominations", choice: [p.options[0]!, p.options[1]!] }, ctx);
      else if (p.kind === "veto-decision") ev = applyBaseline(s, { kind: "veto-decision", use: false }, ctx);
      else if (p.kind === "replacement") ev = applyBaseline(s, { kind: "replacement", replacement: p.options[0]! }, ctx);
      else if (p.kind === "eviction-vote") ev = applyBaseline(s, { kind: "eviction-vote", vote: p.nominees[0] }, ctx);
      else if (p.kind === "tie-break") ev = applyBaseline(s, { kind: "tie-break", evict: p.nominees[0] }, ctx);
      else if (p.kind === "final-eviction") ev = applyBaseline(s, { kind: "final-eviction", evict: p.options[0]! }, ctx);
      else if (p.kind === "houseguests-choice") ev = applyBaseline(s, { kind: "houseguests-choice", pick: p.options[0]! }, ctx, rng);
      else if (p.kind === "goodbye-message") ev = applyBaseline(s, { kind: "goodbye-message", tone: p.tones[0]! }, ctx);
      else if (p.kind === "finale-statement") ev = applyBaseline(s, { kind: "finale-statement", statement: "" }, ctx);
      else if (p.kind === "finale-answer") ev = applyBaseline(s, { kind: "finale-answer", appeal: p.appeals[0]! }, ctx);
      else if (p.kind === "juror-question") ev = applyBaseline(s, { kind: "juror-question", question: "" }, ctx);
      else if (p.kind === "juror-vote") ev = applyBaseline(s, { kind: "juror-vote", vote: p.finalists[0] }, ctx);
      else throw new Error(`baseline: unhandled pending ${p.kind}`);
      record(traj, ev);
    } else {
      record(traj, advanceBaseline(s, ctx, rng));
    }
  }
  traj.evictionOrder = [...s.evictionOrder];
  traj.winner = s.winner;
  traj.finalTwo = s.finalTwo ? [...s.finalTwo] : undefined;
  return traj;
}

describe("PR #395 — staged competitions are FULL-TRAJECTORY byte-identical to the non-staged baseline", () => {
  // A spread of house sizes + seeds: each plays a SHORT-but-COMPLETE game both ways. This is the fast
  // litmus that stands in for the heavy jury-aggregate band — if every trajectory matches the baseline,
  // the band (which passed on the baseline) passes again.
  for (const size of [5, 8, 12]) {
    for (const seed of [1, 2, 3, 7, 13, 42]) {
      it(`size ${size}, seed ${seed}: same eviction order, same winners, same jury reach`, () => {
        const h = buildHouse(size, seed);
        const staged = playStaged(h.active, { player: PLAYER, statsOf: h.statsOf, rel: h.rel() }, seed);
        const baseline = playBaseline(h.active, { player: PLAYER, statsOf: h.statsOf, rel: h.rel() }, seed);

        // Both engines reach a real ending (a sanity guard so an empty trajectory can't pass trivially).
        expect(baseline.winner, "baseline must crown a winner").toBeDefined();
        expect(staged.winner, "staged must crown a winner").toBeDefined();

        // THE LITMUS: the entire eviction ORDER is byte-identical → who reaches jury is identical.
        expect(staged.evictionOrder, "eviction order (and thus jury reach) must match the baseline").toEqual(baseline.evictionOrder);
        // Every ceremony-defining beat (every HOH/veto winner, every nomination, every eviction, the
        // crown) is byte-identical, in order.
        expect(staged.ceremonies, "every ceremony winner / nomination / eviction must match the baseline").toEqual(baseline.ceremonies);
        // The endgame facts are identical.
        expect(staged.winner).toBe(baseline.winner);
        expect(staged.finalTwo).toEqual(baseline.finalTwo);
      });
    }
  }

  it("the staged eviction order is non-trivial (a real, multi-eviction game was played)", () => {
    const h = buildHouse(12, 7);
    const staged = playStaged(h.active, { player: PLAYER, statsOf: h.statsOf, rel: h.rel() }, 7);
    // 12 houseguests → 10 evicted, 2 in the final. (Guards that the litmus exercised a full season.)
    expect(staged.evictionOrder.length).toBe(10);
    expect(staged.finalTwo).toHaveLength(2);
    expect(staged.finalTwo).toContain(staged.winner);
  });
});
