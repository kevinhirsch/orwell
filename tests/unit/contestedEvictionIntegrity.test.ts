import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeRuntime } from "../../src/composition/runtime";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import type { HealthRecord } from "../../src/composition/orchestrator";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import type { AdvanceView, PendingDecisionView } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { SessionSnapshot } from "../../src/engine/sessionSnapshot";
import { PLAYER, npc } from "../../src/domain/ids";

/**
 * #1106 — the engine integrity circuit OPENED during a contested eviction (and recovered).
 *
 * Forensic context (2026-06-27 convergence mining of `engine.log`): SIX consecutive
 *   `[orwell] integrity fault user=default trigger=player-turn kinds=degradation`
 * — the last `circuit=OPEN` — correlated 1:1 with six FE `pre-emission guard HELD a phantom
 * closed-set outcome` fires in a ~3s burst. The player was on the block; the narration model
 * REPEATEDLY narrated the eviction outcome AHEAD of the engine commit, and each ahead-of-the-board
 * write produced a candidate that DROPPED persisted detail (a phantom that re-rendered fewer events
 * than the committed baseline holds). The fail-closed non-degradation checkpoint (0031) correctly
 * REFUSED all six, rolled each back to the intact prior save (`registry.restore(baseline)` — NO data
 * loss), and tripped the `BREAKER_THRESHOLD` circuit. Recovery was automatic: `commitPlayerTurn`
 * never SKIPS on an open circuit (only off-screen ticks do), so the next clean turn reset the circuit
 * and the eviction committed; the game reached its finale.
 *
 * DIAGNOSIS: the six faults were REAL degradations the guard correctly caught — NOT false positives.
 * The fix is UPSTREAM (the model narrating ahead — #1107 momentPrompts); the checkpoint behaved
 * exactly as mandate #4 demands and MUST NOT be weakened. These regression tests pin the diagnosis:
 * the 6-fault → OPEN → recover sequence, zero data loss on every rollback, and that a genuine
 * degradation is STILL refused (the guard is intact).
 *
 * HARD rule: roles only — no names.
 */
const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-1106-"));
const TURN_OFF = { tickEveryMs: 0, idleTickAfterMs: 0, maxOffscreenTicksPerWake: 0, auditEveryMs: 0 };

function resolveLegally(s: GameSessionAdapter, p: PendingDecisionView): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

/** Drive a real game until the eviction-vote pending of the FIRST week, leaving it UNRESOLVED so the
 *  test can exercise the contested-eviction commit pattern at exactly that beat. */
function driveToFirstEvictionVote(sb: { session: GameSessionAdapter }): AdvanceView {
  let view: AdvanceView = sb.session.advanceGame();
  for (let i = 0; i < 80; i++) {
    if (view.finished) throw new Error("game finished before reaching an eviction-vote");
    if (view.pending?.kind === "eviction-vote") return view;
    if (view.pending) resolveLegally(sb.session, view.pending);
    view = sb.session.advanceGame();
  }
  throw new Error("never reached an eviction-vote");
}

describe("#1106 — the contested-eviction integrity fault sequence (correctly caught, recovers, no data loss)", () => {
  it("six narrate-ahead degrading player-turn commits → circuit OPENS → next clean turn recovers; prior save intact throughout", () => {
    const dir = freshDir();
    const user = "default";
    const runtime = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: TURN_OFF });
    const reg = runtime.registry;
    const orch = runtime.orchestrator;
    const sb = reg.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Player", seed: 11 });

    // Drive to a real contested beat: the first week's eviction-vote, left unresolved. Every step here
    // committed cleanly through the checkpoint, so the durable save now holds a real, healthy game.
    const atEviction = driveToFirstEvictionVote(sb);
    expect(atEviction.pending?.kind).toBe("eviction-vote");

    // The good, committed baseline the checkpoint will protect — captured from the durable save, exactly
    // what `registry.restore(baseline)` rolls back TO on a refused commit.
    const goodSave: SessionSnapshot = new FileSaveStore(dir).loadLatest(user)!;
    const goodEventCount = goodSave.events.length;
    expect(goodEventCount).toBeGreaterThan(0);
    const goodBlob = JSON.stringify(goodSave);

    // The narrate-ahead candidate: the model narrates the eviction outcome AHEAD of the board, and the
    // resulting ahead-of-the-board write re-renders a candidate that has LOST persisted detail (here:
    // a dropped tail of events — the realistic shape of a phantom commit). This is a GENUINE degradation,
    // not a false positive: persisted detail would thin out if it ever committed (mandate #4 forbids it).
    const degradedCandidate: SessionSnapshot = {
      ...goodSave,
      events: goodSave.events.slice(0, Math.max(1, goodEventCount - 2)),
    };

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let attempt = 1; attempt <= 6; attempt++) {
        // The FE's narrate-ahead commit lands a degrading candidate in the live sandbox, then the
        // registry's commit funnel runs the checkpoint (the same path `onPersist` drives in production).
        reg.restore(user, degradedCandidate);
        expect(() => orch.commitPlayerTurn(user)).toThrowError(/turn refused/);

        const health = orch.sandboxHealth(user) as HealthRecord;
        // Every refusal is a `degradation` fault — the precise kind the forensic log recorded.
        expect(health.lastIntegrity).toBe("fault");
        expect(health.faults.at(-1)!.kind).toBe("degradation");
        // The breaker (BREAKER_THRESHOLD = 3): the circuit OPENS once three consecutive faults stack.
        expect(health.circuitOpen).toBe(attempt >= 3);

        // NO DATA LOSS: the prior good save is byte-for-byte intact after every rollback. A refused
        // commit never persists — the durable save is exactly the healthy pre-burst game.
        expect(JSON.stringify(new FileSaveStore(dir).loadLatest(user)!)).toBe(goodBlob);
      }

      // The circuit is OPEN after the six-fault burst (mirrors the `circuit=OPEN` on the 6th log line)…
      expect((orch.sandboxHealth(user) as HealthRecord).circuitOpen).toBe(true);

      // …and the fail-closed rollback ALREADY left the live sandbox at the last GOOD committed baseline
      // (every refused `commitPlayerTurn` calls `registry.restore(baseline)` internally). The orchestrator
      // also still holds that good baseline, so recovery needs NO external re-ground — exactly the live
      // recovery in #1106: a player-turn NEVER skips on an open circuit (only off-screen ticks do), so the
      // next clean turn just works. Re-fetch the (restored) live session and resolve the eviction legally.
      const live = reg.sandboxFor(user);
      const refetched = live.session.advanceGame();
      const pending = refetched.pending ?? atEviction.pending!;
      if (pending.kind === "eviction-vote") resolveLegally(live.session, pending); // the real eviction → a committed beat
      else if (pending) resolveLegally(live.session, pending);

      const recovered = orch.sandboxHealth(user) as HealthRecord;
      // The circuit CLOSED on the clean commit, and the eviction's beat committed cleanly.
      expect(recovered.circuitOpen).toBe(false);
      expect(recovered.lastIntegrity).toBe("ok");

      // The eviction ultimately COMMITTED and PERSISTED — the durable save advanced past the pre-burst
      // game (the recovered turn recorded its events), and the game can keep advancing to the finale.
      const afterSave = new FileSaveStore(dir).loadLatest(user)!;
      expect(afterSave.events.length).toBeGreaterThan(goodEventCount);
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("#1106 — the non-degradation guard is NOT weakened by the recovery path", () => {
  it("a GENUINE degradation is STILL refused (dropped persisted detail never commits)", () => {
    const dir = freshDir();
    const user = "u";
    {
      const r1 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: TURN_OFF });
      r1.registry.sandboxFor(user).session.createCharacter({ playerName: "The Player", seed: 7 });
      r1.registry.sandboxFor(user).session.advanceGame();
    }
    // Resume the healthy game; the boot preload seeds the non-degradation baseline from the save.
    const runtime = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: TURN_OFF });
    const snap = runtime.registry.snapshot(user);
    expect(snap.events.length).toBeGreaterThan(0);
    const goodBlob = JSON.stringify(new FileSaveStore(dir).loadLatest(user)!);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Drop persisted events — a real thinning. Even AFTER the recovery path exists, the guard must
      // refuse it: non-degradation (mandate #4) is intact.
      runtime.registry.restore(user, { ...snap, events: snap.events.slice(0, 1) });
      expect(() => runtime.orchestrator.commitPlayerTurn(user)).toThrowError(/turn refused/);
      expect((runtime.orchestrator.sandboxHealth(user) as HealthRecord).faults.some((f) => f.kind === "degradation")).toBe(true);
      // The prior good save was never overwritten by the refused commit.
      expect(JSON.stringify(new FileSaveStore(dir).loadLatest(user)!)).toBe(goodBlob);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a leak (Vault content with no pathway) is STILL refused at the same beat — the guard's other arm is intact", () => {
    const runtime = composeRuntime({ saveStore: new FileSaveStore(freshDir()), clock: new FakeClock(), watcher: TURN_OFF });
    const user = "leaker";
    const sb = runtime.registry.sandboxFor(user);
    sb.session.createCharacter({ playerName: "The Player", seed: 2 });

    const SECRET = "LEAK-1106-SENTINEL";
    sb.engine.events.record({ id: "leak:h", ts: 1, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: `secret ${SECRET}` });
    sb.engine.events.record({ id: "leak:v", ts: 2, type: "house-event", initiator: npc(1), witnessSet: [PLAYER, npc(1)], hidden: false, content: `secret ${SECRET}` });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => runtime.orchestrator.commitPlayerTurn(user)).toThrowError(/turn refused/);
      expect(runtime.registry.sandboxFor(user).engine.events.queryAll().some((e) => e.content.includes(SECRET))).toBe(false);
    } finally {
      errSpy.mockRestore();
    }
  });
});
