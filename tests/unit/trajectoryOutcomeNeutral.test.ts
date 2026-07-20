import { describe, it, expect } from "vitest";
import { richOffscreenStretch } from "../../src/engine/offscreen";
import { RelationshipModel } from "../../src/engine/relationships";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import type { RandomnessSource } from "../../src/ports/RandomnessSource";
import { STEADY, type Trajectory } from "../../src/engine/trajectory";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import {
  newLiveSeason, advance, applyDecision,
  type LiveSeasonState, type SeasonCtx, type BeatEvent,
} from "../../src/engine/liveSeason";
import type { Stats } from "../../src/engine/season";

/**
 * Feature 0087 — the CALIBRATION-NEUTRALITY GATE (the `stagedTrajectoryNeutral` / `deepProfileOutcomeNeutral`
 * sibling). The off-screen society's rng stream is calibration-load-bearing: the SAME seeded stream draws
 * off-screen scenes AND advances the seeded competition/vote spine. Relationship trajectories must be
 * PROVABLY inert to that spine:
 *
 *   • Flag OFF ⇒ the off-screen scene sequence AND the seeded competition/vote outcomes are BYTE-IDENTICAL
 *     to the pre-feature build (no `trajectoryOf` is passed ⇒ `natureWeights` is the identity).
 *   • Flag ON ⇒ the off-screen stream's DRAW COUNT and ORDER are unchanged (the tilt re-weights the SAME
 *     single nature `weightedPick`, adds NO rng draw and consumes none) — only WHICH nature each draw lands
 *     on shifts. So the competition/vote rolls reading the same stream stay in phase.
 *
 * HARD rule: roles only — no names; all fixtures generated.
 */

const NPCS: EntityId[] = [npc(1), npc(2), npc(3), npc(4), npc(5), npc(6)];

/** A wrapping rng that RECORDS every `next()` value — the exact draw stream the calibration spine shares. */
class RecordingRandom implements RandomnessSource {
  readonly draws: number[] = [];
  constructor(private readonly inner: RandomnessSource) {}
  next(): number { const v = this.inner.next(); this.draws.push(v); return v; }
  int(maxExclusive: number): number { if (maxExclusive <= 0) return 0; return Math.floor(this.next() * maxExclusive); }
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("empty"); return items[this.int(items.length)]!;
  }
  fork(label: string): RandomnessSource { return this.inner.fork(label); }
}

/** A motivated, co-present house with a spread of edge signals (so natures actually vary). */
function motivatedRel(seed: number): RelationshipModel {
  const r = new SeededRandom(seed);
  const rel = new RelationshipModel(0.5);
  for (const a of NPCS) for (const b of NPCS) {
    if (a === b) continue;
    const e = rel.edge(a, b);
    e.affinity = r.next(); e.trust = r.next(); e.threat = r.next(); e.alignment = r.next();
  }
  return rel;
}

/** Run the off-screen stretch (motivated path) with an optional trajectory provider, on a RECORDING rng. */
function runStretch(seed: number, trajectoryOf?: (a: EntityId, b: EntityId) => Trajectory): {
  draws: number[]; natures: string[];
} {
  const rel = motivatedRel(7);
  const events = new InMemoryEventStore();
  const rng = new RecordingRandom(new SeededRandom(seed));
  const scenes = richOffscreenStretch({
    events, rng, npcs: NPCS, interactions: 8,
    edgeOf: (a, b) => rel.edge(a, b),
    ...(trajectoryOf ? { trajectoryOf } : {}),
  });
  return { draws: rng.draws, natures: scenes.map((s) => `${s.initiator}|${s.partner}|${s.type}`) };
}

describe("0087 — the off-screen draw stream is calibration-neutral to trajectories", () => {
  // A strongly-committed souring arc for EVERY pair — the maximal tilt, so if anything could re-phase the
  // stream, this would. (The phase→bias for souring pushes conflict/betrayal and kills warmth.)
  const souringAll = (): ((a: EntityId, b: EntityId) => Trajectory) => () => ({ phase: "souring", momentum: 1 });

  it("flag OFF (no trajectoryOf) is byte-identical to passing a STEADY/zero-momentum provider", () => {
    for (const seed of [1, 2, 3, 7, 13, 42]) {
      const off = runStretch(seed); // pre-feature path (no provider)
      const steady = runStretch(seed, () => STEADY); // provider present but identity tilt
      expect(steady.draws, `seed ${seed}: STEADY tilt consumes the same draws`).toEqual(off.draws);
      expect(steady.natures, `seed ${seed}: STEADY tilt yields the same natures`).toEqual(off.natures);
    }
  });

  it("flag ON (max souring tilt): the DRAW COUNT and ORDER are unchanged — only natures shift", () => {
    let anyNatureShifted = false;
    for (const seed of [1, 2, 3, 7, 13, 42, 99, 123]) {
      const off = runStretch(seed);
      const on = runStretch(seed, souringAll());
      // THE LOAD-BEARING PROPERTY: the rng draw stream the competition/vote spine shares is byte-identical.
      expect(on.draws, `seed ${seed}: the off-screen draw stream is byte-identical with trajectories ON`).toEqual(off.draws);
      if (JSON.stringify(on.natures) !== JSON.stringify(off.natures)) anyNatureShifted = true;
    }
    // Sanity (the test isn't vacuous): a maximal tilt DID change which nature some draws landed on.
    expect(anyNatureShifted, "a strong tilt must actually shift some scene natures").toBe(true);
  });

  it("the tilt never manufactures a gated betrayal (0078 gate stays absolute)", () => {
    // Strangers only (no pair clears the betrayal bond/threat floor) — natureWeights gives betrayal 0.
    const rel = new RelationshipModel(0.5);
    for (const a of NPCS) for (const b of NPCS) {
      if (a === b) continue;
      const e = rel.edge(a, b); e.affinity = 0.05; e.trust = 0.05; e.threat = 0.9; e.alignment = 0.05;
    }
    let betrayals = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const events = new InMemoryEventStore();
      const scenes = richOffscreenStretch({
        events, rng: new SeededRandom(seed), npcs: NPCS, interactions: 4,
        edgeOf: (a, b) => rel.edge(a, b),
        trajectoryOf: () => ({ phase: "souring", momentum: 1 }), // maximal souring push at betrayal
      });
      betrayals += scenes.filter((s) => s.type === "betrayal").length;
    }
    expect(betrayals, "souring momentum cannot manufacture a betrayal where the 0078 gate is unmet").toBe(0);
  });
});

// --- The seeded competition/vote spine reading the same stream stays byte-identical ----------------------

/** A seeded house: balanced stats + a seeded relationship graph (IDENTICAL inputs across runs). */
function buildHouse(size: number, seed: number): { active: EntityId[]; statsOf: (id: EntityId) => Stats; rel: () => RelationshipModel } {
  const rng = new SeededRandom(seed);
  const active: EntityId[] = [PLAYER, ...Array.from({ length: size - 1 }, (_, i) => npc(i + 1))];
  const stats = new Map<EntityId, Stats>();
  for (const id of active) stats.set(id, { physical: rng.next(), mental: rng.next(), social: rng.next() });
  const edges = new Map<string, { trust: number; affinity: number; threat: number }>();
  for (const a of active) for (const b of active) {
    if (a === b) continue;
    edges.set(`${a}|${b}`, { trust: rng.next(), affinity: rng.next(), threat: rng.next() });
  }
  const freshRel = (): RelationshipModel => {
    const rel = new RelationshipModel(0.5);
    for (const a of active) for (const b of active) {
      if (a === b) continue;
      const e = rel.edge(a, b); const s = edges.get(`${a}|${b}`)!;
      e.trust = s.trust; e.affinity = s.affinity; e.threat = s.threat; e.confidence = 0.5;
    }
    return rel;
  };
  return { active, statsOf: (id) => stats.get(id)!, rel: freshRel };
}

interface Trajectory2 { ceremonies: string[]; evictionOrder: EntityId[]; winner: EntityId | undefined; finalTwo: EntityId[] | undefined; }
const TRAJECTORY_BEATS = new Set(["hoh-competition", "veto-competition", "nominations", "veto-ceremony", "eviction", "final-eviction", "finale-result"]);

/** Drive a complete seeded game with a fixed passive policy; capture the full trajectory of outcomes. */
function playGame(active: EntityId[], ctx: SeasonCtx, seed: number): Trajectory2 {
  const s: LiveSeasonState = newLiveSeason(active);
  const rng = new SeededRandom(seed);
  const t: Trajectory2 = { ceremonies: [], evictionOrder: [], winner: undefined, finalTwo: undefined };
  const rec = (ev: BeatEvent | null): void => { if (ev && TRAJECTORY_BEATS.has(ev.beat)) t.ceremonies.push(`${ev.beat}: ${ev.content}`); };
  for (let guard = 0; guard < 20_000 && !s.finished; guard++) {
    if (s.pending) {
      const p = s.pending;
      if (p.kind === "comp-round" || p.kind === "comp-intent") rec(applyDecision(s, { kind: p.kind, intent: "compete" }, ctx, rng));
      else if (p.kind === "nominations") rec(applyDecision(s, { kind: "nominations", choice: [p.options[0]!, p.options[1]!] }, ctx));
      else if (p.kind === "veto-decision") rec(applyDecision(s, { kind: "veto-decision", use: false }, ctx));
      else if (p.kind === "replacement") rec(applyDecision(s, { kind: "replacement", replacement: p.options[0]! }, ctx));
      else if (p.kind === "eviction-vote") rec(applyDecision(s, { kind: "eviction-vote", vote: p.nominees[0] }, ctx));
      else if (p.kind === "tie-break") rec(applyDecision(s, { kind: "tie-break", evict: p.nominees[0] }, ctx));
      else if (p.kind === "final-eviction") rec(applyDecision(s, { kind: "final-eviction", evict: p.options[0]! }, ctx));
      else if (p.kind === "houseguests-choice") rec(applyDecision(s, { kind: "houseguests-choice", pick: p.options[0]! }, ctx, rng));
      else if (p.kind === "goodbye-message") rec(applyDecision(s, { kind: "goodbye-message", tone: p.tones[0]! }, ctx));
      else if (p.kind === "exit-interview") rec(applyDecision(s, { kind: "exit-interview", stance: p.stances[0]! }, ctx));
      else if (p.kind === "finale-statement") rec(applyDecision(s, { kind: "finale-statement", statement: "" }, ctx));
      else if (p.kind === "finale-answer") rec(applyDecision(s, { kind: "finale-answer", appeal: p.appeals[0]! }, ctx));
      else if (p.kind === "juror-question") rec(applyDecision(s, { kind: "juror-question", question: "" }, ctx));
      else if (p.kind === "juror-vote") rec(applyDecision(s, { kind: "juror-vote", vote: p.finalists[0] }, ctx));
      else throw new Error(`unhandled pending ${p.kind}`);
    } else {
      rec(advance(s, ctx, rng));
    }
  }
  t.evictionOrder = [...s.evictionOrder];
  t.winner = s.winner;
  t.finalTwo = s.finalTwo ? [...s.finalTwo] : undefined;
  return t;
}

describe("0087 — a full seeded game's competition/vote outcomes are deterministic (the spine the off-screen stream feeds)", () => {
  // The trajectory layer touches ONLY the off-screen society's nature pick (orchestrator), never the
  // liveSeason competition/vote rolls. This re-proves the spine is a pure function of the seed (so flag
  // OFF — which leaves the off-screen path byte-identical — cannot change any of these outcomes), exactly
  // the property the heavy jury-aggregate band rests on, WITHOUT the heavy sims.
  for (const size of [5, 8, 12]) {
    for (const seed of [1, 7, 42]) {
      it(`size ${size}, seed ${seed}: same eviction order, winner, and Final 2 on replay`, () => {
        const h = buildHouse(size, seed);
        const a = playGame(h.active, { player: PLAYER, statsOf: h.statsOf, rel: h.rel() }, seed);
        const b = playGame(h.active, { player: PLAYER, statsOf: h.statsOf, rel: h.rel() }, seed);
        expect(a.winner, "a winner is crowned").toBeDefined();
        expect(b.evictionOrder).toEqual(a.evictionOrder);
        expect(b.ceremonies).toEqual(a.ceremonies);
        expect(b.winner).toBe(a.winner);
        expect(b.finalTwo).toEqual(a.finalTwo);
      });
    }
  }
});
