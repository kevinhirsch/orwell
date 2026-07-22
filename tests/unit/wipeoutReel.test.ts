import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { RelationshipModel } from "../../src/engine/relationships";
import type { Stats } from "../../src/engine/season";
import {
  deriveFailureFact, priorWipeoutCount, appendWipeoutHistory,
  type WipeoutHistoryEntry,
} from "../../src/engine/wipeoutReel";
import {
  newLiveSeason, advance, applyDecision,
  type LiveSeasonState, type SeasonCtx, type BeatEvent, type PendingDecision,
} from "../../src/engine/liveSeason";

/**
 * C1 (#1788, Q8 hybrid-greenlit small+reversible build) — the Wipeout Reel: a seeded, archetype-flavored
 * `failureStyle` fact-to-voice on each pre-rolled staged-comp drop. This gate covers:
 *   1. the pure phrase-composition module (`wipeoutReel.ts`) — determinism, archetype signature, the
 *      persisted-callback clause;
 *   2. the flag-OFF byte-identity pin at the engine level (`comp-elimination` content + the whole
 *      trajectory unchanged, mirroring `stagedTrajectoryNeutral.test.ts`'s discipline);
 *   3. the flag-ON accumulation/persistence round-trip (`s.wipeoutHistory` grows, survives a plain-JSON
 *      save/restore round-trip, and the outcome axis — winner/dropOrder/eviction order — stays byte-
 *      identical to the flag-off run);
 *   4. a structural no-Vault-content pin (the module never references VaultStore/hidden content).
 */

describe("wipeoutReel — pure failure-style derivation", () => {
  it("is deterministic given the same rng position + inputs", () => {
    const a = deriveFailureFact(new SeededRandom(7), "hothead", 0.5, "endurance", 0);
    const b = deriveFailureFact(new SeededRandom(7), "hothead", 0.5, "endurance", 0);
    expect(a).toEqual(b);
  });

  it("draws only from the named archetype's own bank (a comic SIGNATURE, never the full cross-pool)", () => {
    const HOTHEAD_PHRASES = [
      "gets heated, rushes it, and blows the whole thing",
      "slams through the round and pays for the sloppiness",
    ];
    for (let seed = 0; seed < 25; seed++) {
      const fact = deriveFailureFact(new SeededRandom(seed), "hothead", undefined, undefined, 0);
      expect(fact.archetype).toBe("hothead");
      expect(HOTHEAD_PHRASES.some((p) => fact.text.startsWith(p))).toBe(true);
    }
  });

  it("falls back to the generic bank for an unset/unrecognized archetype (a legacy save)", () => {
    const fact = deriveFailureFact(new SeededRandom(3), undefined, undefined, undefined, 0);
    expect(fact.archetype).toBe("generic");
    expect(fact.text.length).toBeGreaterThan(0);
  });

  it("appends a mood qualifier only when an emotional state is provided", () => {
    const withMood = deriveFailureFact(new SeededRandom(1), "underdog", 0.05, undefined, 0);
    const withoutMood = deriveFailureFact(new SeededRandom(1), "underdog", undefined, undefined, 0);
    // A very low emotional state reads as "shaken" ⇒ "visibly rattled" qualifier appended.
    expect(withMood.text).toContain("visibly rattled");
    expect(withoutMood.text).not.toContain("visibly rattled");
  });

  it("appends a format-appropriate clause when the comp format is known", () => {
    const fact = deriveFailureFact(new SeededRandom(2), "analyst", undefined, "quiz", 0);
    expect(fact.text).toContain("a question they absolutely knew a minute ago");
  });

  it("appends NO callback clause on a fresh houseguest's first-ever wipeout", () => {
    const fact = deriveFailureFact(new SeededRandom(4), "floater", undefined, undefined, 0);
    expect(fact.text).not.toContain("this season");
  });

  it("appends a persisted-callback clause once priorWipeouts > 0 (mandate #4, felt)", () => {
    const second = deriveFailureFact(new SeededRandom(4), "floater", undefined, undefined, 1);
    const third = deriveFailureFact(new SeededRandom(4), "floater", undefined, undefined, 2);
    expect(second.text).toContain("the second time this season");
    expect(third.text).toMatch(/the 3rd time this season/);
  });

  it("never emits a raw number — only composed prose + the small fixed vocabulary", () => {
    for (const archetype of [undefined, "villain", "mastermind", "peacemaker"]) {
      for (const emo of [undefined, 0, 0.5, 1]) {
        const fact = deriveFailureFact(new SeededRandom(9), archetype, emo, "puzzle", 3);
        expect(fact.text).not.toMatch(/0\.\d/); // no stray float ever leaks into the composed text
      }
    }
  });
});

describe("wipeoutReel — history accumulation (MONOTONIC, mandate #4: never lost)", () => {
  it("appendWipeoutHistory only ever grows a houseguest's record", () => {
    const history: Record<EntityId, WipeoutHistoryEntry[]> = {};
    const id = npc(1);
    expect(priorWipeoutCount(history[id])).toBe(0);
    appendWipeoutHistory(history, id, { week: 1, comp: "hoh-competition", text: "first wipeout." });
    expect(priorWipeoutCount(history[id])).toBe(1);
    appendWipeoutHistory(history, id, { week: 1, comp: "veto-competition", text: "second wipeout." });
    expect(priorWipeoutCount(history[id])).toBe(2);
    // Append-only: the FIRST entry is never touched by a later append.
    expect(history[id]![0]!.text).toBe("first wipeout.");
    expect(history[id]![1]!.text).toBe("second wipeout.");
  });

  it("round-trips losslessly through plain JSON (the persisted-state contract)", () => {
    const history: Record<EntityId, WipeoutHistoryEntry[]> = {};
    appendWipeoutHistory(history, npc(2), { week: 2, comp: "hoh-competition", text: "a wipeout, visibly rattled." });
    appendWipeoutHistory(history, npc(2), { week: 3, comp: "veto-competition", text: "another one — the second time this season." });
    const roundTripped = JSON.parse(JSON.stringify(history)) as typeof history;
    expect(roundTripped).toEqual(history);
    expect(roundTripped[npc(2)]).toHaveLength(2);
  });
});

describe("wipeoutReel — no-Vault-content structural pin", () => {
  /** Every `import ... from "..."` line in a source file (module specifiers only, not prose comments). */
  function importSpecifiers(src: string): string[] {
    return [...src.matchAll(/^\s*import[^\n]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
  }

  it("never imports VaultStore (or any port under src/ports that isn't RandomnessSource)", () => {
    const src = readFileSync(join(__dirname, "../../src/engine/wipeoutReel.ts"), "utf8");
    const specifiers = importSpecifiers(src);
    expect(specifiers.some((s) => /VaultStore/i.test(s))).toBe(false);
    for (const s of specifiers) {
      if (s.includes("/ports/")) expect(s).toMatch(/RandomnessSource$/);
    }
  });

  it("liveSeason.ts's wipeout wiring adds no VaultStore import", () => {
    const src = readFileSync(join(__dirname, "../../src/engine/liveSeason.ts"), "utf8");
    expect(importSpecifiers(src).some((s) => /VaultStore/i.test(s))).toBe(false);
  });
});

// --- Engine-level integration: flag-off byte-identity + flag-on accumulation/outcome-neutrality ---

interface Trajectory {
  ceremonies: string[];
  compEliminationContent: string[];
  evictionOrder: EntityId[];
  winner: EntityId | undefined;
  finalTwo: EntityId[] | undefined;
}

const TRAJECTORY_BEATS = new Set([
  "hoh-competition", "veto-competition", "nominations", "veto-ceremony",
  "eviction", "final-eviction", "finale-result",
]);

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
      const e = rel.edge(a, b);
      const seeded = edges.get(`${a}|${b}`)!;
      e.trust = seeded.trust; e.affinity = seeded.affinity; e.threat = seeded.threat; e.confidence = 0.5;
    }
    return rel;
  };
  return { active, statsOf: (id) => stats.get(id)!, rel: freshRel };
}

/** A fixed, seeded ARCHETYPE per npc index — deterministic, exercises the per-archetype signature bank. */
const TEST_ARCHETYPES = ["hothead", "mastermind", "floater", "villain", "underdog", "analyst", "loyalist"];
function archetypeFor(id: EntityId): string | undefined {
  if (id === PLAYER) return "wildcard";
  const m = /(\d+)$/.exec(id);
  const i = m ? Number(m[1]) : 0;
  return TEST_ARCHETYPES[i % TEST_ARCHETYPES.length];
}

/** Drive a full game to completion with a fixed passive policy, recording the trajectory + wipeout state. */
function play(active: EntityId[], ctx: SeasonCtx, seed: number): { traj: Trajectory; s: LiveSeasonState } {
  const s: LiveSeasonState = newLiveSeason(active);
  const rng = new SeededRandom(seed);
  const traj: Trajectory = { ceremonies: [], compEliminationContent: [], evictionOrder: [], winner: undefined, finalTwo: undefined };
  const record = (ev: BeatEvent | null): void => {
    if (!ev) return;
    if (TRAJECTORY_BEATS.has(ev.beat)) traj.ceremonies.push(`${ev.beat}: ${ev.content}`);
    if (ev.beat === "comp-elimination") traj.compEliminationContent.push(ev.content);
  };
  for (let guard = 0; guard < 20_000 && !s.finished; guard++) {
    if (s.pending) {
      const p: PendingDecision = s.pending;
      let ev: BeatEvent | null = null;
      if (p.kind === "comp-round" || p.kind === "comp-intent") ev = applyDecision(s, { kind: p.kind, intent: "compete" }, ctx, rng);
      else if (p.kind === "nominations") ev = applyDecision(s, { kind: "nominations", choice: [p.options[0]!, p.options[1]!] }, ctx);
      else if (p.kind === "veto-decision") ev = applyDecision(s, { kind: "veto-decision", use: false }, ctx);
      else if (p.kind === "replacement") ev = applyDecision(s, { kind: "replacement", replacement: p.options[0]! }, ctx);
      else if (p.kind === "eviction-vote") ev = applyDecision(s, { kind: "eviction-vote", vote: p.nominees[0] }, ctx);
      else if (p.kind === "tie-break") ev = applyDecision(s, { kind: "tie-break", evict: p.nominees[0] }, ctx);
      else if (p.kind === "final-eviction") ev = applyDecision(s, { kind: "final-eviction", evict: p.options[0]! }, ctx);
      else if (p.kind === "houseguests-choice") ev = applyDecision(s, { kind: "houseguests-choice", pick: p.options[0]! }, ctx, rng);
      else if (p.kind === "goodbye-message") ev = applyDecision(s, { kind: "goodbye-message", tone: p.tones[0]! }, ctx);
      else if (p.kind === "exit-interview") ev = applyDecision(s, { kind: "exit-interview", stance: p.stances[0]! }, ctx);
      else if (p.kind === "finale-statement") ev = applyDecision(s, { kind: "finale-statement", statement: "" }, ctx);
      else if (p.kind === "finale-answer") ev = applyDecision(s, { kind: "finale-answer", appeal: p.appeals[0]! }, ctx);
      else if (p.kind === "juror-question") ev = applyDecision(s, { kind: "juror-question", question: "" }, ctx);
      else if (p.kind === "juror-vote") ev = applyDecision(s, { kind: "juror-vote", vote: p.finalists[0] }, ctx);
      else break; // an out-of-scope pending (self-evict/secret-veto/deal-offer) — never raised by this driver
      record(ev);
    } else {
      record(advance(s, ctx, rng));
    }
  }
  traj.evictionOrder = [...s.evictionOrder];
  traj.winner = s.winner;
  traj.finalTwo = s.finalTwo ? [...s.finalTwo] : undefined;
  return { traj, s };
}

describe("wipeoutReel — engine flag-off byte-identity (the C1 reversibility pin)", () => {
  for (const size of [5, 8]) {
    for (const seed of [1, 11]) {
      it(`size ${size}, seed ${seed}: comp-elimination content + full trajectory unchanged when the flag is absent`, () => {
        const h = buildHouse(size, seed);
        const ctxOff: SeasonCtx = { player: PLAYER, statsOf: h.statsOf, rel: h.rel() };
        const ctxExplicitFalse: SeasonCtx = { player: PLAYER, statsOf: h.statsOf, rel: h.rel(), wipeoutReelEnabled: false };
        const off = play(h.active, ctxOff, seed);
        const explicitFalse = play(h.active, ctxExplicitFalse, seed);
        expect(off.traj).toEqual(explicitFalse.traj);
        expect(off.s.wipeoutHistory).toBeUndefined();
        expect(explicitFalse.s.wipeoutHistory).toBeUndefined();
      });
    }
  }
});

describe("wipeoutReel — engine flag-on: outcome-neutral, presentation-enriched, history accumulates", () => {
  for (const size of [6, 9]) {
    for (const seed of [1, 5, 21]) {
      it(`size ${size}, seed ${seed}: SAME trajectory as flag-off, DIFFERENT comp-elimination text, history recorded`, () => {
        const h = buildHouse(size, seed);
        const ctxOff: SeasonCtx = { player: PLAYER, statsOf: h.statsOf, rel: h.rel() };
        const ctxOn: SeasonCtx = {
          player: PLAYER, statsOf: h.statsOf, rel: h.rel(),
          wipeoutReelEnabled: true, archetypeOf: archetypeFor,
        };
        const off = play(h.active, ctxOff, seed);
        const on = play(h.active, ctxOn, seed);

        // THE LITMUS (mirrors stagedTrajectoryNeutral): the outcome axis never moves.
        expect(on.traj.ceremonies, "every ceremony winner/nomination/eviction must match flag-off").toEqual(off.traj.ceremonies);
        expect(on.traj.evictionOrder, "eviction order (and jury reach) must match flag-off").toEqual(off.traj.evictionOrder);
        expect(on.traj.winner).toBe(off.traj.winner);
        expect(on.traj.finalTwo).toEqual(off.traj.finalTwo);

        // The PRESENTATION layer is enriched: at least one comp-elimination reveal carries new text.
        expect(on.traj.compEliminationContent.length).toBeGreaterThan(0);
        expect(on.traj.compEliminationContent).not.toEqual(off.traj.compEliminationContent);
        for (let i = 0; i < off.traj.compEliminationContent.length; i++) {
          // The flag-on content is the SAME template the flag-off content used, PLUS an appended
          // wipeout fact — never a replacement, and the beat sequence/order is unchanged (the outcome
          // axis assertions above already prove the drop order itself never moved).
          expect(on.traj.compEliminationContent[i]).toContain(off.traj.compEliminationContent[i]);
        }

        // Accumulation: the season-spanning history is populated and every entry traces to a real,
        // engine-composed failure-style fact (non-empty text).
        expect(on.s.wipeoutHistory).toBeDefined();
        const allEntries = Object.values(on.s.wipeoutHistory!).flat();
        expect(allEntries.length).toBeGreaterThan(0);
        for (const entry of allEntries) {
          expect(entry.text.length).toBeGreaterThan(0);
          expect(["hoh-competition", "veto-competition"]).toContain(entry.comp);
        }

        // Persistence round-trip: plain JSON, lossless.
        const roundTripped = JSON.parse(JSON.stringify(on.s.wipeoutHistory)) as typeof on.s.wipeoutHistory;
        expect(roundTripped).toEqual(on.s.wipeoutHistory);
      });
    }
  }

  it("a houseguest who wipes out more than once accumulates a CALLBACK entry ('...this season')", () => {
    // A small house forces heavy overlap between the HOH and veto fields across several weeks, so the
    // SAME non-winning houseguest very likely loses more than one staged comp before eviction/finale.
    let found = false;
    for (let seed = 1; seed <= 12 && !found; seed++) {
      const h = buildHouse(6, seed);
      const ctxOn: SeasonCtx = {
        player: PLAYER, statsOf: h.statsOf, rel: h.rel(),
        wipeoutReelEnabled: true, archetypeOf: archetypeFor,
      };
      const { s } = play(h.active, ctxOn, seed);
      for (const entries of Object.values(s.wipeoutHistory ?? {})) {
        if (entries.length >= 2) {
          expect(entries[1]!.text).toMatch(/this season/);
          found = true;
          break;
        }
      }
    }
    expect(found, "expected at least one seed to produce a repeat wipeout with a callback clause").toBe(true);
  });
});
