import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { crossToNextDay } from "../../src/engine/liveSeason";
import type { LiveSeasonState } from "../../src/engine/liveSeason";
import { WAKE_HOUR, DAY_START } from "../../src/engine/timeOfDay";
import type { AdvanceView, GameSession } from "../../src/ports/GameSession";

/**
 * #1320 — the HOH→nominations NIGHT-GATE (ADR 0006 pacing, the "deeper half" of the fast-forward fix,
 * PR #1309/#1320). The DEDICATED calibration-neutrality gate — the `perConversationClockNeutral` /
 * `stagedTrajectoryNeutral` sibling; replicate-never-skip (the SOUL minimum build bar).
 *
 * The gate inserts a diegetic `day-break` beat BETWEEN the HOH crown and the nominations, so nominations
 * land the NEXT in-fiction day (Day-1-HOH → Day-2-noms cadence) instead of the same moment as the crown.
 * It is GATED behind the clock pacing (`perConversationClockEnabled && timeOfDayEnabled` — the same pair
 * the per-conversation clock rides). The load-bearing claims:
 *
 *   • BYTE-IDENTICAL WHEN THE MASTER CLOCK IS OFF (the calibration spine — the EXACT state the
 *     juryReach/gradient/UAT sims run in): the night-gate can NEVER fire, no `day-break` beat is ever
 *     emitted, and the seeded competition/vote/jury OUTCOME stream is byte-identical. Master clock off
 *     gates it, so it can never perturb the calibration band.
 *   • NON-VACUOUS + PRESENTATION-ONLY when the clock is running: a `day-break` beat DOES fire, seated
 *     strictly between the HOH crown and the nominations, crossing the night to a fresh morning — and it
 *     is INERT (no rng draw), so it never re-phases the seeded stream.
 *
 * Roles only — no names; all fixtures generated.
 */

const SEED = 7;

afterEach(() => {
  GameSessionAdapter.setTimeOfDayEnabled(null);
  delete process.env.ORWELL_TIME_OF_DAY;
});

interface Outcome {
  ceremonies: string[];
  evictionOrder: string[];
  winner: string | undefined;
  dayBreaks: number;
}

/** The beats that DEFINE the seeded outcome trajectory (not presentation drops / the day-break). */
const OUTCOME_BEATS = new Set([
  "hoh-competition", "veto-competition", "nominations", "veto-ceremony",
  "eviction", "final-eviction", "finale-result",
]);

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

/**
 * Play a full seeded game through the live adapter + the TURN-DRIVEN orchestrator (so the per-turn
 * off-screen tick — where the per-conversation clock rides — actually fires). `clockOn` flips the master
 * clock; `perConvOn` flips the per-conversation clock (⇒ the night-gate rides the AND of the two).
 */
function play(opts: { clockOn: boolean; perConvOn: boolean }): Outcome {
  GameSessionAdapter.setTimeOfDayEnabled(opts.clockOn);
  const reg = new GameSessionRegistry();
  const user = "ng";
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", archetype: "floater", seed: SEED });
  sb.session.setPerConversationClockEnabled(opts.perConvOn);
  const orch = new Orchestrator(reg, new FakeClock(), { seed: SEED, turnDriven: true });
  reg.setCommit((u) => orch.commitPlayerTurn(u));
  reg.setOnReset((u) => orch.forgetUser(u));

  const out: Outcome = { ceremonies: [], evictionOrder: [], winner: undefined, dayBreaks: 0 };
  for (let i = 0; i < 4000; i++) {
    const adv = sb.session.advanceGame();
    if (adv.event?.beat === "day-break") out.dayBreaks++;
    if (adv.event && OUTCOME_BEATS.has(adv.event.beat)) out.ceremonies.push(`${adv.event.beat}: ${adv.event.content}`);
    if (adv.pending) resolveLegally(sb.session, adv.pending);
    if (adv.finished) break;
  }
  const snap = sb.session.snapshot();
  out.evictionOrder = [...(snap.live?.evictionOrder ?? [])];
  out.winner = snap.live?.winner;
  return out;
}

const hash = (o: Outcome): string =>
  createHash("sha256").update(JSON.stringify({ c: o.ceremonies, e: o.evictionOrder, w: o.winner })).digest("hex");

describe("#1320 night-gate — HOH→nominations day boundary is calibration-neutral", () => {
  it("CALIBRATION SPINE (master clock OFF): the night-gate is fully inert — byte-identical, zero day-breaks", () => {
    // Exactly the harness state the seeded juryReach/gradient/UAT sims run in. The night-gate rides the
    // master clock, so flipping the per-conversation clock can never fire it and never perturbs the stream.
    const off = play({ clockOn: false, perConvOn: false });
    const on = play({ clockOn: false, perConvOn: true });
    expect(off.winner, "the game reaches a real ending").toBeDefined();
    expect(off.evictionOrder.length, "a real multi-eviction game was played").toBeGreaterThan(3);
    expect(off.dayBreaks, "master clock OFF ⇒ the night-gate can never fire").toBe(0);
    expect(on.dayBreaks, "flipping the per-conversation clock with the master clock OFF still can't fire it").toBe(0);
    expect(hash(on), "master clock OFF ⇒ the night-gate is inert ⇒ byte-identical seeded outcomes").toBe(hash(off));
  });

  it("master clock ON, per-conversation OFF: still a deterministic fixed point with NO day-break", () => {
    // The golden-replay state (`ORWELL_TIME_PER_CONVERSATION=0` pins per-conv off): the night-gate rides
    // BOTH flags, so per-conv off ⇒ inert ⇒ no day-break ⇒ byte-identical, exactly what the committed
    // fixture needs to replay against.
    const a = play({ clockOn: true, perConvOn: false });
    const b = play({ clockOn: true, perConvOn: false });
    expect(a.winner).toBeDefined();
    expect(a.dayBreaks, "per-conversation OFF ⇒ the night-gate stays inert (the golden-replay pin)").toBe(0);
    expect(hash(a), "per-conv OFF is a deterministic fixed point (same seed ⇒ same SHA256)").toBe(hash(b));
  });
});

describe("#1320 night-gate — the pure cross + the live gate are correct", () => {
  it("crossToNextDay is a no-op until the clock is running, then resets to the next 8am morning", () => {
    const dormant = { evictionOrder: [] } as unknown as LiveSeasonState; // nightDepth undefined
    crossToNextDay(dormant);
    expect(dormant.nightDepth, "dormant until the per-beat clock starts the day").toBeUndefined();

    const running = { nightDepth: 26, timeOfDay: "late-night", playerRetired: false, evictionOrder: [] } as unknown as LiveSeasonState;
    crossToNextDay(running);
    expect(running.nightDepth, "crosses to the fresh 8am wake").toBe(WAKE_HOUR);
    expect(running.timeOfDay, "a new morning").toBe(DAY_START);
    expect(running.lastSleepDepth, "no sleep debt is stamped by the structural day boundary").toBeUndefined();
  });

  it("NON-VACUOUS (master + per-conversation ON): a single day-break fires between the HOH crown and the nominations", () => {
    GameSessionAdapter.setTimeOfDayEnabled(true);
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("ng2");
    sb.session.createCharacter({ playerName: "The Player", archetype: "floater", seed: SEED });
    sb.session.setPerConversationClockEnabled(true);
    const orch = new Orchestrator(reg, new FakeClock(), { seed: SEED, turnDriven: true });
    reg.setCommit((u) => orch.commitPlayerTurn(u));
    reg.setOnReset((u) => orch.forgetUser(u));

    // Walk week 1 only: capture the ORDERED beat stream (with the timeOfDay each landed at) up to and
    // including the first nominations beat.
    const beats: { beat: string; timeOfDay: string | undefined }[] = [];
    for (let i = 0; i < 200; i++) {
      const adv = sb.session.advanceGame();
      if (adv.event) beats.push({ beat: adv.event.beat, timeOfDay: sb.session.gameStatus().timeOfDay });
      if (adv.pending) resolveLegally(sb.session, adv.pending);
      if (adv.event?.beat === "nominations") break;
    }
    const hohIdx = beats.findIndex((b) => b.beat === "hoh-competition");
    const dayBreakIdx = beats.findIndex((b) => b.beat === "day-break");
    const nomsIdx = beats.findIndex((b) => b.beat === "nominations");
    expect(hohIdx, "the HOH is crowned").toBeGreaterThanOrEqual(0);
    expect(nomsIdx, "the nominations resolve").toBeGreaterThan(hohIdx);
    expect(dayBreakIdx, "a day-break is inserted after the HOH crown").toBeGreaterThan(hohIdx);
    expect(dayBreakIdx, "…and strictly BEFORE the nominations (the gate seats noms a day on)").toBeLessThan(nomsIdx);
    expect(beats.filter((b) => b.beat === "day-break").length, "exactly one day-break per reign (one-shot)").toBe(1);
    // The crown and the nominations are no longer the same in-fiction moment — the day-break wrapped the
    // clock back to a fresh morning (a new day), and the noms follow on that day (their exact phase then
    // drifts with the player's own per-conversation lingering, which is the point — the day now has time).
    expect(beats[dayBreakIdx]!.timeOfDay, "the day-break lands the house at the fresh morning wake").toBe(DAY_START);
  });

  it("Phase 3a — a day-break seats EACH cadence beat (noms, veto, veto-ceremony, eviction) a day on", () => {
    // The week is now one major beat per in-fiction day (WEEKLY_CADENCE): HOH → noms → veto → veto
    // ceremony → eviction, each preceded by its own one-shot day-break. So a full week-1 walk sees FOUR
    // day-breaks (one per transition after the HOH crown), never two ceremonies stacked in one day.
    GameSessionAdapter.setTimeOfDayEnabled(true);
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("ng3");
    sb.session.createCharacter({ playerName: "The Player", archetype: "floater", seed: SEED });
    sb.session.setPerConversationClockEnabled(true);
    const orch = new Orchestrator(reg, new FakeClock(), { seed: SEED, turnDriven: true });
    reg.setCommit((u) => orch.commitPlayerTurn(u));
    reg.setOnReset((u) => orch.forgetUser(u));

    const names: string[] = [];
    for (let i = 0; i < 400; i++) {
      const adv = sb.session.advanceGame();
      if (adv.event) names.push(adv.event.beat);
      if (adv.pending) resolveLegally(sb.session, adv.pending);
      if ((sb.session.snapshot().live?.evictionOrder ?? []).length > 0) break; // stop at the first eviction
    }
    expect(names.filter((n) => n === "day-break").length, "four day-breaks — one per cadence transition in week 1").toBe(4);
    // …and each cadence beat is preceded by a day-break (the beat lands a day on, never same-day as the prior).
    for (const beat of ["nominations", "veto-competition", "veto-ceremony", "eviction"]) {
      const bi = names.indexOf(beat);
      if (bi < 0) continue; // a name that doesn't surface this seed is covered by the exact count above
      expect(names.lastIndexOf("day-break", bi - 1), `a day-break precedes ${beat}`).toBeGreaterThanOrEqual(0);
    }
  });
});
