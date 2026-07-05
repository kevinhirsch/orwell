import { describe, it, expect } from "vitest";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { RelationshipModel } from "../../src/engine/relationships";
import type { Stats } from "../../src/engine/season";
import {
  newLiveSeason, advance, applyDecision, isInertBeat,
  type LiveSeasonState, type SeasonCtx, type BeatEvent,
} from "../../src/engine/liveSeason";

/**
 * BB-14 (2026-07-03 final-pre-ship audit, bb-nerd lane) — "No HOH-room reveal — 'Who wants to see
 * my HOH room?!', the letter from home, the basket" was missing entirely: nothing in `liveSeason.ts`
 * staged the show's weekly emotional heartbeat between the HOH crown and nominations.
 *
 * The fix adds a genuine but PRESENTATION-ONLY structural beat (`hoh-reveal`) that fires exactly once
 * after a non-Final-3 HOH crown, before nominations — mirroring how the veto chip draw (E35) precedes
 * the veto comp. It reads the ALREADY-DECIDED HOH and computes nothing: it is INERT (`INERT_BEATS`),
 * so it can never perturb the seeded trajectory. This file is the neutrality proof, in the same style
 * as `stagedTrajectoryNeutral.test.ts`. HARD rule: roles only — no names.
 */
function buildHouse(size: number, seed: number): { active: EntityId[]; ctx: SeasonCtx } {
  const rng = new SeededRandom(seed);
  const active: EntityId[] = [PLAYER, ...Array.from({ length: size - 1 }, (_, i) => npc(i + 1))];
  const stats = new Map<EntityId, Stats>();
  for (const id of active) stats.set(id, { physical: rng.next(), mental: rng.next(), social: rng.next() });
  const rel = new RelationshipModel(0.5);
  for (const a of active) for (const b of active) {
    if (a === b) continue;
    const e = rel.edge(a, b);
    e.trust = rng.next(); e.affinity = rng.next(); e.threat = rng.next(); e.confidence = 0.5;
  }
  return { active, ctx: { player: PLAYER, statsOf: (id) => stats.get(id)!, rel } };
}

/**
 * Drive the live loop to completion with a simple legal-default policy, collecting every beat event.
 * `skipReveal` reproduces the PRE-fix behavior exactly: whenever the loop lands on `hoh-reveal` it is
 * bypassed WITHOUT ever calling `advance()` for it (so no `hoh-reveal` BeatEvent is ever recorded) —
 * the same trajectory the engine produced before this fix existed.
 */
function playToEnd(s: LiveSeasonState, ctx: SeasonCtx, seed: number, opts?: { skipReveal?: boolean }): BeatEvent[] {
  const rng = new SeededRandom(seed);
  const events: BeatEvent[] = [];
  for (let guard = 0; guard < 20_000 && !s.finished; guard++) {
    if (opts?.skipReveal && !s.pending && s.beat === "hoh-reveal") {
      s.beat = "nominations";
      continue;
    }
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
      else if (p.kind === "comp-round") events.push(applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng));
      else if (p.kind === "goodbye-message") events.push(applyDecision(s, { kind: "goodbye-message", tone: p.tones[0]! }, ctx));
      else if (p.kind === "juror-question") events.push(applyDecision(s, { kind: "juror-question", question: "q" }, ctx));
      else if (p.kind === "juror-vote") events.push(applyDecision(s, { kind: "juror-vote", vote: p.finalists[0] }, ctx));
    } else {
      const ev = advance(s, ctx, rng);
      if (ev) events.push(ev);
    }
  }
  return events;
}

/** The beats that DEFINE the trajectory — the same whitelist `stagedTrajectoryNeutral.test.ts` uses;
 *  `hoh-reveal` is deliberately excluded (it never decides anything). */
const TRAJECTORY_BEATS = new Set([
  "hoh-competition", "veto-competition", "nominations", "veto-ceremony",
  "eviction", "final-eviction", "finale-result",
]);

describe("BB-14 — the weekly HOH-room reveal (presentation only)", () => {
  it("fires exactly once, right after a non-Final-3 HOH crown, and names the ALREADY-DECIDED HOH", () => {
    const { active, ctx } = buildHouse(10, 5);
    const s = newLiveSeason(active);
    const rng = new SeededRandom(5);
    // Drive to the very first HOH crown.
    let crown: BeatEvent | null = null;
    for (let g = 0; g < 200 && !crown; g++) {
      const p = s.pending;
      if (p?.kind === "comp-round" || p?.kind === "comp-intent") {
        const ev = p.kind === "comp-round"
          ? applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng)
          : applyDecision(s, { kind: "comp-intent", intent: "compete" }, ctx, rng);
        if (ev.beat === "hoh-competition") crown = ev;
      } else {
        const ev = advance(s, ctx, rng);
        if (ev?.beat === "hoh-competition") crown = ev;
      }
    }
    expect(crown).not.toBeNull();
    const hoh = crown!.participants[0]!;
    // The crown hands off to the reveal — not straight to nominations.
    expect(s.beat).toBe("hoh-reveal");
    expect(isInertBeat("hoh-reveal")).toBe(true);

    const reveal = advance(s, ctx, rng);
    expect(reveal?.beat).toBe("hoh-reveal");
    expect(reveal?.participants).toEqual([hoh]); // names the SAME already-decided HOH — computes nothing
    expect(s.beat).toBe("nominations"); // hands off; the reveal never repeats

    // The very next resolved beat is ordinary play, never a second reveal.
    if (s.hoh !== ctx.player) {
      const next = advance(s, ctx, rng);
      expect(next?.beat).not.toBe("hoh-reveal");
    }
  });

  it("Final 3 skips the reveal entirely — final-eviction follows the final-HOH crown directly", () => {
    const ctx: SeasonCtx = { player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel: new RelationshipModel(0.5) };
    const s = newLiveSeason([PLAYER, npc(1), npc(2)]); // three active ⇒ opens on the final HOH comp
    const rng = new SeededRandom(9);
    let crown: BeatEvent | null = null;
    for (let g = 0; g < 50 && !crown; g++) {
      if (s.pending?.kind === "comp-round") {
        const ev = applyDecision(s, { kind: "comp-round", intent: "compete" }, ctx, rng);
        if (ev.beat === "hoh-competition") crown = ev;
      } else {
        const ev = advance(s, ctx, rng);
        if (ev?.beat === "hoh-competition") crown = ev;
      }
    }
    expect(crown).not.toBeNull();
    expect(s.beat).toBe("final-eviction"); // no room reveal at Final 3 — same as before this fix
  });

  it("NEUTRALITY (byte-identity): winner / finalTwo / evictionOrder / jury and every trajectory-" +
    "defining beat are UNCHANGED whether the reveal fires or is bypassed", () => {
    for (const seed of [1, 7, 21]) {
      const a = buildHouse(10, seed);
      const withReveal = newLiveSeason(a.active);
      const evA = playToEnd(withReveal, a.ctx, seed);

      const b = buildHouse(10, seed);
      const withoutReveal = newLiveSeason(b.active);
      const evB = playToEnd(withoutReveal, b.ctx, seed, { skipReveal: true });

      // The OUTCOME (what the audience actually cares about) never moves.
      expect(withReveal.winner).toBe(withoutReveal.winner);
      expect(withReveal.finalTwo).toEqual(withoutReveal.finalTwo);
      expect(withReveal.evictionOrder).toEqual(withoutReveal.evictionOrder);
      expect(withReveal.jury).toEqual(withoutReveal.jury);

      // Every trajectory-defining beat (comp crowns, noms, veto, evictions, the finale result) is
      // byte-identical whether or not the inert reveal beat rides along.
      const trajA = evA.filter((e) => TRAJECTORY_BEATS.has(e.beat)).map((e) => `${e.beat}: ${e.content}`);
      const trajB = evB.filter((e) => TRAJECTORY_BEATS.has(e.beat)).map((e) => `${e.beat}: ${e.content}`);
      expect(trajA).toEqual(trajB);

      // The reveal itself appears ONLY in the with-reveal run, once per non-Final-3 HOH ever crowned.
      const reveals = evA.filter((e) => e.beat === "hoh-reveal");
      const crowns = evA.filter((e) => e.beat === "hoh-competition");
      expect(evB.some((e) => e.beat === "hoh-reveal")).toBe(false);
      expect(reveals.length).toBeGreaterThan(0);
      expect(reveals.length).toBeLessThanOrEqual(crowns.length);
    }
  });
});
