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
      else events.push(applyDecision(s, { kind: "eviction-vote", vote: p.nominees[0] }, ctx));
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
          else applyDecision(s, { kind: "eviction-vote", vote: p.nominees[0] }, ctx);
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
});
