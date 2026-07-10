import { describe, it, expect, afterEach } from "vitest";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { GameSessionRegistry } from "../../src/composition/registry";
import { feltHoursFromMinutes, SCENE_FELT_MINUTES, CLOCK } from "../../src/engine/sleepConstants";
import { PLAYER } from "../../src/domain/ids";

/**
 * Phase 2 (duration-based clock) — a recorded social scene carries the LLM's proposed felt duration
 * (`feltMinutes`), and the day clock advances by that BOUNDED duration on the next per-turn tick instead
 * of the flat floor. So time tracks the play the player actually did ("a quick word" vs "a long summit").
 *
 * Calibration-safe by construction: the advance rides `advanceClockPerConversation`, self-gated on the
 * master clock — the seeded juryReach/UAT sims run clock-OFF, so `feltMinutes` is fully inert there
 * (proven here). Roles only; all fixtures generated. No fold, no number crosses to the player.
 */

const SEED = 7;

afterEach(() => {
  GameSessionAdapter.setTimeOfDayEnabled(null);
});

/** A wired sandbox with the clock + per-conversation extension ON, the day started, and one NPC id. */
function startedWithClock(): { session: ReturnType<GameSessionRegistry["sandboxFor"]>["session"]; commands: ReturnType<GameSessionRegistry["sandboxFor"]>["commands"]; npc: string } {
  GameSessionAdapter.setTimeOfDayEnabled(true);
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor("felt");
  sb.session.createCharacter({ playerName: "The Player", archetype: "floater", seed: SEED });
  sb.session.setPerConversationClockEnabled(true);
  sb.session.advanceGame(); // start the day (initializes the clock)
  const npc = [...sb.session.livingIds()].find((id) => id !== PLAYER)!;
  return { session: sb.session, commands: sb.commands, npc };
}

const depth = (s: { snapshot: () => { live?: { nightDepth?: number } | null } }): number => s.snapshot().live?.nightDepth ?? 0;

describe("Phase 2 — feltMinutes drives the per-conversation clock", () => {
  it("advances the clock by the scene's proposed felt duration, not the flat floor", () => {
    const { session, commands, npc } = startedWithClock();
    const start = depth(session);
    commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc], content: "a long strategy summit", feltMinutes: 120 });
    session.advanceClockPerConversation(); // the orchestrator's per-turn tick consumes the stash
    expect(depth(session) - start).toBeCloseTo(2, 5); // 120 min = 2h, not the 0.5h floor
  });

  it("clamps an absurd proposal to the sane envelope (anti-abuse)", () => {
    const { session, commands, npc } = startedWithClock();
    const start = depth(session);
    commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc], content: "a quick word", feltMinutes: 6000 });
    session.advanceClockPerConversation();
    expect(depth(session) - start).toBeCloseTo(SCENE_FELT_MINUTES.max / 60, 5); // clamped to 4h, not 100h
  });

  it("falls back to the flat floor when no feltMinutes is proposed (byte-identical to pre-Phase-2)", () => {
    const { session, commands, npc } = startedWithClock();
    const start = depth(session);
    commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc], content: "an untimed scene" });
    session.advanceClockPerConversation();
    expect(depth(session) - start).toBeCloseTo(CLOCK.perConversationHours, 5);
  });

  it("is consumed once — a later tick with no new scene uses the floor again", () => {
    const { session, commands, npc } = startedWithClock();
    commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc], content: "a chat", feltMinutes: 90 });
    session.advanceClockPerConversation(); // consumes the 90-min stash
    const mid = depth(session);
    session.advanceClockPerConversation(); // no new scene ⇒ the floor
    expect(depth(session) - mid).toBeCloseTo(CLOCK.perConversationHours, 5);
  });

  it("is INERT when the master clock is off (the calibration-spine guarantee)", () => {
    GameSessionAdapter.setTimeOfDayEnabled(false);
    const reg = new GameSessionRegistry();
    const sb = reg.sandboxFor("felt-off");
    sb.session.createCharacter({ playerName: "The Player", seed: SEED });
    sb.session.setPerConversationClockEnabled(true);
    sb.session.advanceGame();
    const npc = [...sb.session.livingIds()].find((id) => id !== PLAYER)!;
    const before = sb.session.snapshot().live?.nightDepth;
    sb.commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc], content: "x", feltMinutes: 200 });
    sb.session.advanceClockPerConversation();
    expect(sb.session.snapshot().live?.nightDepth).toBe(before); // clock off ⇒ nothing moves
  });
});

describe("Phase 2 — feltHoursFromMinutes (pure)", () => {
  it("clamps to the envelope and floors a non-proposal", () => {
    expect(feltHoursFromMinutes(120)).toBeCloseTo(2, 5);
    expect(feltHoursFromMinutes(5)).toBeCloseTo(SCENE_FELT_MINUTES.min / 60, 5); // below min ⇒ min
    expect(feltHoursFromMinutes(6000)).toBeCloseTo(SCENE_FELT_MINUTES.max / 60, 5); // above max ⇒ max
    expect(feltHoursFromMinutes(undefined)).toBeCloseTo(CLOCK.perConversationHours, 5);
    expect(feltHoursFromMinutes(0)).toBeCloseTo(CLOCK.perConversationHours, 5);
  });
});
