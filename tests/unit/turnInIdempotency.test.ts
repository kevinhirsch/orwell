import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeRuntime } from "../../src/composition/runtime";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { StaleBeatError } from "../../src/domain/errors";
import type { AdvanceView, GameSession } from "../../src/ports/GameSession";
import type { UserSandbox } from "../../src/composition/registry";

/**
 * ADR 0006 / feature 0065 — `turnIn` (the player's bedtime lever) is a mutating PROGRESSION tool, so it
 * MUST carry the same at-most-once + compare-and-swap guard as its siblings `advanceGame` /
 * `submitDecision`. Before this guard a retried/duplicate model call re-ran `playerTurnIn`, which reads
 * `nightDepth` and stamps `lastSleepDepth` — but the FIRST call resets `nightDepth` to the wake hour, so
 * the SECOND call re-stamps `lastSleepDepth = WAKE_HOUR`, ERASING the earned late-night rest penalty
 * (the player gets a free "fully rested" outcome instead of the first result being replayed).
 *
 * This pins the fix at the McpServer boundary — the runtime dispatch path the narration model actually
 * calls — so a missing arg-guard/dispatch case (dead-at-runtime) would fail here. HARD rule: roles only.
 */

const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-turnin-"));

afterEach(() => GameSessionAdapter.setTimeOfDayEnabled(null));

/** Resolve any pending decision legally, so the live loop always progresses. */
function resolveLegally(s: Pick<GameSession, "submitDecision">, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-intent" || p.kind === "comp-round") s.submitDecision({ kind: p.kind, intent: "compete" });
  else if (p.kind === "houseguests-choice") s.submitDecision({ kind: "houseguests-choice", vote: p.options[0]!.id });
  else if (p.kind === "goodbye-message") s.submitDecision({ kind: "goodbye-message", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

/**
 * A turn-driven runtime with the in-game clock ON (ADR 0006 opt-in — turnIn is dormant otherwise) and a
 * mid-season game whose clock is running. A few real weekly-loop advances move the night off the wake
 * hour, so a re-stamp WOULD change `lastSleepDepth` — making the erased-rest-penalty bug real here.
 */
function runningClockGame(seed = 3): { sb: UserSandbox } {
  GameSessionAdapter.setTimeOfDayEnabled(true);
  const runtime = composeRuntime({ saveStore: new FileSaveStore(freshDir()), clock: new FakeClock() });
  const sb = runtime.registry.sandboxFor("u");
  sb.session.createCharacter({ playerName: "P", seed });
  let adv: AdvanceView = sb.session.advanceGame();
  for (let i = 0; i < 6 && !adv.finished; i++) {
    if (adv.pending) resolveLegally(sb.session, adv.pending);
    adv = sb.session.advanceGame();
  }
  return { sb };
}

describe("0065 — turnIn is an at-most-once mutating progression (the erased-rest-penalty fix)", () => {
  it("a duplicate turnIn with the SAME idempotencyKey replays verbatim and re-ends the night EXACTLY once", async () => {
    const { sb } = runningClockGame();
    const mcp = sb.mcp.player;
    const first = (await mcp.callTool("turnIn", { idempotencyKey: "sleep-1" })) as AdvanceView;
    const seq = sb.session.gameStatus().beatSeq;
    // The retry — dispatched through the SAME McpServer boundary the narration model calls.
    const replay = (await mcp.callTool("turnIn", { idempotencyKey: "sleep-1" })) as AdvanceView;
    // Verbatim cached replay (its beatSeq, its dailyRecap, everything).
    expect(replay).toEqual(first);
    // …and the night ended EXACTLY once: no second commit ⇒ `playerTurnIn` did NOT re-run ⇒ `lastSleepDepth`
    // was NOT re-stamped from the reset wake hour (the earned rest penalty stands). Without the guard this
    // second call re-executes: a fresh commit (beatSeq moves) and a different, re-stamped result.
    expect(sb.session.gameStatus().beatSeq).toBe(seq);
  });

  it("a stale expectedBeatSeq is refused with StaleBeatError BEFORE any mutation; the current token is honored", async () => {
    const { sb } = runningClockGame();
    const current = sb.session.gameStatus().beatSeq;
    await expect(sb.mcp.player.callTool("turnIn", { expectedBeatSeq: current - 1 })).rejects.toThrow(StaleBeatError);
    expect(sb.session.gameStatus().beatSeq).toBe(current); // refused before any write — nothing moved
    // The CURRENT token ⇒ the night ends and the board advances (the CAS lets the real write through).
    const ok = (await sb.mcp.player.callTool("turnIn", { expectedBeatSeq: current })) as AdvanceView;
    expect(ok).toBeTruthy();
    expect(sb.session.gameStatus().beatSeq).toBeGreaterThan(current);
  });

  it("a malformed expectedBeatSeq is a deliberate arg refusal (E31 shape guard), never a blind cast into a spurious 409", async () => {
    // Proves the `case \"turnIn\"` arg-guard is wired: without it the malformed value falls through to
    // guardBeatSeq and throws StaleBeatError instead of the shape refusal below.
    const { sb } = runningClockGame();
    await expect(sb.mcp.player.callTool("turnIn", { expectedBeatSeq: "nope" })).rejects.toThrow(/must be a number when present/);
  });

  it("an ABSENT idempotencyKey/expectedBeatSeq is unchanged — turnIn still ends the night (opt-in)", async () => {
    const { sb } = runningClockGame();
    const before = sb.session.gameStatus().beatSeq;
    const v = (await sb.mcp.player.callTool("turnIn", {})) as AdvanceView;
    expect(v).toBeTruthy();
    expect(sb.session.gameStatus().beatSeq).toBeGreaterThan(before); // a real committed night-end
  });
});
