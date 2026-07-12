import { describe, it, expect, afterEach } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { GameSessionRegistry } from "../../src/composition/registry";
import { advanceClock } from "../../src/engine/liveSeason";
import type { LiveSeasonState } from "../../src/engine/liveSeason";
import { beatFeltHours } from "../../src/engine/daySchedule";
import { CLOCK } from "../../src/engine/sleepConstants";
import type { AdvanceView, GameSession } from "../../src/ports/GameSession";

/**
 * Feature 0119 (Phase 3, final, of the in-game-time pivot) — DIFFERENT EVENTS COST DIFFERENT AMOUNTS of the
 * in-game day: a quick nomination/veto ceremony ~1h, a competition ~3h, an eviction/finale ~2h, instead of
 * a flat +3h per beat. Applied only when the per-conversation clock is live, so golden replay (that clock
 * off, master on) keeps the flat default and the seeded spine (time-of-day off) is byte-identical. Roles
 * only; in-game time only.
 */

afterEach(() => GameSessionAdapter.setTimeOfDayEnabled(null));

const liveAt = (nightDepth: number): LiveSeasonState =>
  ({ nightDepth, timeOfDay: "morning" } as unknown as LiveSeasonState);

describe("0119 — beatFeltHours: each event has its own felt cost", () => {
  it("comps run long, ceremonies are quick, evictions/finale sit in between", () => {
    expect(beatFeltHours("hoh-competition")).toBe(3);
    expect(beatFeltHours("veto-competition")).toBe(3);
    expect(beatFeltHours("nominations")).toBe(1);
    expect(beatFeltHours("veto-ceremony")).toBe(1);
    expect(beatFeltHours("eviction")).toBe(2);
    expect(beatFeltHours("final-eviction")).toBe(2);
    expect(beatFeltHours("finale")).toBe(2);
    // A quick ceremony genuinely costs LESS of the day than a competition.
    expect(beatFeltHours("nominations")!).toBeLessThan(beatFeltHours("hoh-competition")!);
  });

  it("beats with no distinct duration fall back to the flat default (null)", () => {
    expect(beatFeltHours("comp-elimination")).toBeNull(); // inert staged drop
    expect(beatFeltHours("day-break")).toBeNull();        // inert night-gate
    expect(beatFeltHours("twist-reveal")).toBeNull();
    expect(beatFeltHours("complete")).toBeNull();
    expect(beatFeltHours(undefined)).toBeNull();
  });
});

describe("0119 — advanceClock honors the felt duration; the flat default is preserved", () => {
  it("advances by the hours passed — a ceremony (1h) moves the clock less than a comp (3h)", () => {
    const ceremony = liveAt(10);
    advanceClock(ceremony, beatFeltHours("nominations")!); // +1h
    expect(ceremony.nightDepth).toBe(11);

    const comp = liveAt(10);
    advanceClock(comp, beatFeltHours("hoh-competition")!); // +3h
    expect(comp.nightDepth).toBe(13);
  });

  it("with NO duration argument it advances the flat CLOCK.perBeatHours (byte-identical / golden path)", () => {
    const s = liveAt(10);
    advanceClock(s); // the golden-replay / pre-0119 path
    expect(s.nightDepth).toBe(10 + CLOCK.perBeatHours);
  });
});

function resolveLegally(s: Pick<GameSession, "submitDecision">, p: NonNullable<AdvanceView["pending"]>): void {
  if (p.kind === "nominations") s.submitDecision({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  else if (p.kind === "veto-decision") s.submitDecision({ kind: "veto-decision", use: false });
  else if (p.kind === "replacement") s.submitDecision({ kind: "replacement", replacement: p.options[0]!.id });
  else if (p.kind === "comp-round") s.submitDecision({ kind: "comp-round", intent: "compete" });
  else if (p.kind === "houseguests-choice") s.submitDecision({ kind: "houseguests-choice", vote: p.options[0]!.id });
  else if (p.kind === "goodbye-message") s.submitDecision({ kind: "goodbye-message", vote: p.options[0]!.id });
  else if (p.kind === "finale-statement") s.submitDecision({ kind: "finale-statement", statement: "x" });
  else if (p.kind === "finale-answer") s.submitDecision({ kind: "finale-answer", appeal: p.appeals![0]! });
  else if (p.kind === "juror-vote") s.submitDecision({ kind: "juror-vote", vote: p.options[0]!.id });
  else s.submitDecision({ kind: p.kind, vote: p.options[0]!.id });
}

/** Play a full seeded game via direct advanceGame (no orchestrator/social turns) — isolates the per-beat clock. */
function playOutcome(opts: { clockOn: boolean; perConvOn: boolean; seed: number }): { winner?: string; order: string[] } {
  GameSessionAdapter.setTimeOfDayEnabled(opts.clockOn);
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor("u");
  sb.session.createCharacter({ playerName: "The Player", seed: opts.seed });
  sb.session.setPerConversationClockEnabled(opts.perConvOn);
  for (let i = 0; i < 4000; i++) {
    const a = sb.session.advanceGame();
    if (a.pending) resolveLegally(sb.session, a.pending);
    if (a.finished) break;
  }
  const snap = sb.session.snapshot();
  return { winner: snap.live?.winner, order: [...(snap.live?.evictionOrder ?? [])] };
}

describe("0119 — the felt duration is pure presentation: it never perturbs the seeded outcome", () => {
  it("on the calibration spine (master clock off) the per-conversation flag can't perturb the seeded stream", () => {
    // With the master clock OFF the whole per-beat clock block (incl. the 0119 felt duration) is skipped —
    // `perConversationClockLive()` is false regardless of the per-conversation flag — so the seeded
    // competition/vote stream (the winner + the whole eviction order) is byte-identical. This is the
    // calibration guarantee the heavy `perConversationClockNeutral`/`juryReach` sims also hold.
    const off = playOutcome({ clockOn: false, perConvOn: false, seed: 7 });
    const flagged = playOutcome({ clockOn: false, perConvOn: true, seed: 7 });
    expect(flagged.winner).toBe(off.winner);
    expect(flagged.order).toEqual(off.order);
  });

  it("with the clock running and variable per-beat durations live, the season still completes cleanly", () => {
    // The variable durations + daily wrap must not wedge the loop: a full game reaches a crowned winner
    // with a complete eviction order. (Draws no rng of its own — pure presentation over the seeded roll.)
    const done = playOutcome({ clockOn: true, perConvOn: true, seed: 7 });
    expect(done.winner).toBeDefined();
    expect(done.order.length).toBeGreaterThan(0);
  });
});
