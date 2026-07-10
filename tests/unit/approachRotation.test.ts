import { describe, it, expect } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { RelationshipModel } from "../../src/engine/relationships";
import { applyApproachCooldown, type Approach } from "../../src/engine/conversation";
import { APPROACH_COOLDOWN_STRETCHES } from "../../src/engine/decisionConstants";
import type { AdvanceView, SubmitDecisionReq } from "../../src/ports/GameSession";
import { npc } from "../../src/domain/ids";

/**
 * Issue #1322 (P2): "one NPC monopolizes approaches (reads as a forced tutorial guide / instant
 * best friend)". Root cause — `rankApproaches` deliberately can't invert a clear relationship gap
 * (0012/0028), so the top seeded-affinity NPC was stably rank 1 EVERY stretch. Fix — a per-NPC
 * anti-recency cooldown applied ONLY at the player-facing projection (`socialInitiatives`), never
 * inside `rankApproaches` itself (which every one of these tests also proves stays untouched).
 */

/** A simple, deterministic player policy — mirrors the one in tests/unit/gameSession.test.ts. */
function resolvePending(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): void {
  const submit = (req: SubmitDecisionReq): void => void s.submitDecision(req);
  if (p.kind === "nominations") submit({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") submit({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") submit({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-intent") submit({ kind: "comp-intent", intent: "compete" });
  else if (p.kind === "finale-statement") submit({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") submit({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") submit({ kind: "juror-vote", vote: p.options[0]!.id });
  else submit({ kind: p.kind, vote: p.options[0]!.id });
}

/** Advance until the first ceremony beat (the week-1 HOH result) commits — approaches stay muted before it (E89). */
function advancePastFirstHoh(s: GameSessionAdapter): void {
  for (let i = 0; i < 200; i++) {
    if (s.snapshot().live?.hoh !== undefined) return;
    const v = s.advanceGame();
    if (v.pending) resolvePending(s, v.pending);
  }
  throw new Error("the week-1 HOH never resolved");
}

/**
 * Drive the live loop, sampling `socialInitiatives()` once per DISTINCT stretch (a distinct
 * week:phase — the exact unit the anti-recency cooldown rotates on) until `stretches` distinct
 * samples are collected or the season ends.
 */
function sampleDistinctStretches(s: GameSessionAdapter, stretches: number): string[][] {
  const history: string[][] = [];
  let lastKey: string | undefined;
  for (let i = 0; i < 20000 && history.length < stretches; i++) {
    const core = s.snapshot();
    const key = `${core.week}:${core.phase}`;
    if (key !== lastKey) {
      lastKey = key;
      const initiators = s.socialInitiatives().map((a) => a.houseguest.id);
      if (initiators.length > 0) history.push(initiators);
    }
    const v = s.advanceGame();
    if (v.finished) break;
    if (v.pending) resolvePending(s, v.pending);
  }
  return history;
}

describe("issue #1322 — approach rotation (anti-recency)", () => {
  it("no NPC leads two CONSECUTIVE stretches — the top seeded-affinity NPC can no longer monopolize every stretch", () => {
    for (const seed of [1, 7, 23, 99]) {
      const s = new GameSessionAdapter();
      s.createCharacter({ playerName: "Player", seed });
      advancePastFirstHoh(s);
      const history = sampleDistinctStretches(s, 12);
      expect(history.length).toBeGreaterThanOrEqual(8); // enough stretches to prove the pattern

      for (let i = 0; i + 1 < history.length; i++) {
        const overlap = history[i]!.filter((id) => history[i + 1]!.includes(id));
        expect(overlap, `stretch ${i} and ${i + 1} both list ${JSON.stringify(overlap)}`).toEqual([]);
      }
    }
  });

  it("an NPC who just initiated does not reappear in the top-3 until its cooldown lapses", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "Player", seed: 42 });
    advancePastFirstHoh(s);
    const history = sampleDistinctStretches(s, 15);
    expect(history.length).toBeGreaterThanOrEqual(10);

    // For every NPC, every gap between two of its appearances must be strictly more than the
    // cooldown window (it sits out APPROACH_COOLDOWN_STRETCHES stretches before it's eligible again).
    const appearances = new Map<string, number[]>();
    history.forEach((initiators, idx) => {
      for (const id of initiators) {
        const list = appearances.get(id) ?? [];
        list.push(idx);
        appearances.set(id, list);
      }
    });
    for (const [id, idxs] of appearances) {
      for (let i = 0; i + 1 < idxs.length; i++) {
        const gap = idxs[i + 1]! - idxs[i]!;
        expect(gap, `${id} reappeared after only ${gap} stretch(es)`).toBeGreaterThan(APPROACH_COOLDOWN_STRETCHES);
      }
    }
  });
});

describe("issue #1322 — applyApproachCooldown (pure projection-layer filter)", () => {
  const a = (id: string, drive: number): Approach => ({ npc: id, drive, motive: "bond" });

  it("sinks a cooling-down NPC below every still-eligible NPC, regardless of its drive", () => {
    const ranked: Approach[] = [a(npc(1), 0.9), a(npc(2), 0.7), a(npc(3), 0.5), a(npc(4), 0.3)];
    const cooldown = new Map([[npc(1), 2]]); // the current top-drive NPC is on cooldown
    const out = applyApproachCooldown(ranked, cooldown);
    expect(out.map((x) => x.npc)).toEqual([npc(2), npc(3), npc(4), npc(1)]);
  });

  it("preserves relative order WITHIN each group — the relationship signal still dominates among eligibles", () => {
    const ranked: Approach[] = [a(npc(1), 0.95), a(npc(2), 0.9), a(npc(3), 0.6), a(npc(4), 0.4), a(npc(5), 0.1)];
    const cooldown = new Map([[npc(1), 1], [npc(4), 2]]);
    const out = applyApproachCooldown(ranked, cooldown);
    // Eligible (2, 3, 5) keep their relative rank order; cooling (1, 4) keep theirs, appended after.
    expect(out.map((x) => x.npc)).toEqual([npc(2), npc(3), npc(5), npc(1), npc(4)]);
  });

  it("a zero-remaining cooldown entry is treated as fully eligible (no off-by-one)", () => {
    const ranked: Approach[] = [a(npc(1), 0.9), a(npc(2), 0.5)];
    const cooldown = new Map([[npc(1), 0]]);
    const out = applyApproachCooldown(ranked, cooldown);
    expect(out.map((x) => x.npc)).toEqual([npc(1), npc(2)]);
  });

  it("never drops an NPC outright — a fully-cooling-down board still returns everyone (a short board never comes up empty)", () => {
    const ranked: Approach[] = [a(npc(1), 0.9), a(npc(2), 0.5)];
    const cooldown = new Map([[npc(1), 2], [npc(2), 1]]);
    const out = applyApproachCooldown(ranked, cooldown);
    expect(out.map((x) => x.npc).sort()).toEqual([npc(1), npc(2)].sort());
  });
});

describe("issue #1322 — approach-cooldown persistence round-trip (0030 non-degradation)", () => {
  it("survives a snapshot/restore and reproduces the identical (still-cooling-down) approach set", () => {
    // The relationship model is a SEPARATE port the registry restores independently (`registry.ts`'s
    // `sb.engine.relationships.load(...)`) — GameSessionAdapter.restore() only owns the SessionCore
    // fields. Share ONE instance across both adapters here so this test isolates exactly what it
    // claims to prove (the cooldown bookkeeping round-trips), not relationship-edge persistence
    // (already covered elsewhere).
    const rel = new RelationshipModel(0.5);
    const s = new GameSessionAdapter(rel);
    s.createCharacter({ playerName: "Player", seed: 5 });
    advancePastFirstHoh(s);

    // Populate the cooldown: read the current stretch, then advance until the stretch actually
    // changes so `syncProjection` rotates the cooldown for whoever was just shown.
    const first = s.socialInitiatives().map((a) => a.houseguest.id);
    expect(first.length).toBeGreaterThan(0);
    const startKey = `${s.snapshot().week}:${s.snapshot().phase}`;
    for (let i = 0; i < 200; i++) {
      const v = s.advanceGame();
      if (v.pending) resolvePending(s, v.pending);
      if (`${s.snapshot().week}:${s.snapshot().phase}` !== startKey) break;
    }

    const core = s.snapshot();
    expect(core.approachCooldown).toBeDefined();
    const cooling = Object.keys(core.approachCooldown ?? {});
    expect(cooling.length).toBeGreaterThan(0);
    // The NPCs shown in the very first stretch are exactly who's cooling down now.
    expect(cooling.sort()).toEqual([...first].sort());

    const restored = new GameSessionAdapter(rel);
    restored.restore(core);
    const restoredCore = restored.snapshot();
    expect(restoredCore.approachCooldown).toEqual(core.approachCooldown);

    // Functionally identical too: the restored adapter excludes the exact same cooling-down NPCs.
    const beforeNext = s.socialInitiatives().map((a) => a.houseguest.id).sort();
    const afterRestore = restored.socialInitiatives().map((a) => a.houseguest.id).sort();
    expect(afterRestore).toEqual(beforeNext);
    for (const id of first) expect(afterRestore).not.toContain(id);
  });

  it("a season restart (createCharacter on a reused instance) clears any prior cooldown", () => {
    const s = new GameSessionAdapter();
    s.createCharacter({ playerName: "Player", seed: 9 });
    advancePastFirstHoh(s);
    s.socialInitiatives();
    for (let i = 0; i < 200; i++) {
      const v = s.advanceGame();
      if (v.pending) resolvePending(s, v.pending);
      if (Object.keys(s.snapshot().approachCooldown ?? {}).length > 0) break;
    }
    expect(Object.keys(s.snapshot().approachCooldown ?? {}).length).toBeGreaterThan(0);

    // A no-op re-call (no `confirmRestart`) leaves the season — and its cooldown — untouched
    // (B36/audit A2 non-degradation); only a CONFIRMED restart may reset it.
    s.createCharacter({ playerName: "Ignored", seed: 9 });
    expect(Object.keys(s.snapshot().approachCooldown ?? {}).length).toBeGreaterThan(0);

    s.createCharacter({ playerName: "Player Two", seed: 9, confirmRestart: true });
    expect(s.snapshot().approachCooldown ?? {}).toEqual({});
  });
});
