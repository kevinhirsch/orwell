import { describe, it, expect } from "vitest";
import {
  TIME_OF_DAY_ORDER, nextPhase, isLateNight, phaseIndex,
  bedtimeFor, isAwakeAt, awakeSet, restDeficitFor, restStatusFor,
  type TimeOfDay,
} from "../../src/engine/timeOfDay";

// Roles only (testing rule): the player, a comp-focused houseguest, a social-game houseguest, a balanced NPC.
const PLAYER = "player";
const COMP_FOCUSED = "comp-focused"; // high physical, low social → protects sleep, early bedtime
const SOCIAL_GAME = "social-game";   // high social, low physical → night owl
const BALANCED = "balanced";         // neither → beds at night

const STATS: Record<string, { physical: number; social: number }> = {
  [COMP_FOCUSED]: { physical: 0.85, social: 0.45 },
  [SOCIAL_GAME]: { physical: 0.45, social: 0.85 },
  [BALANCED]: { physical: 0.6, social: 0.6 },
};
const bedtimeOf = (id: string): TimeOfDay => bedtimeFor(STATS[id]!);

describe("time of day — the day rolls forward by play (ADR 0006)", () => {
  it("has the five public phases in morning→late-night order", () => {
    expect([...TIME_OF_DAY_ORDER]).toEqual(["morning", "afternoon", "evening", "night", "late-night"]);
  });

  it("advances one phase at a time and CLAMPS at late-night (never silently wraps past the bedtime beat)", () => {
    expect(nextPhase("morning")).toBe("afternoon");
    expect(nextPhase("evening")).toBe("night");
    expect(nextPhase("night")).toBe("late-night");
    expect(nextPhase("late-night")).toBe("late-night"); // clamp — a new day must be rolled explicitly
    expect(isLateNight("late-night")).toBe(true);
    expect(isLateNight("evening")).toBe(false);
  });
});

describe("bedtimes are character-driven and deterministic (no randomness, byte-stable)", () => {
  it("the comp-focused protect their sleep; the social game stays up; the balanced bed at night", () => {
    expect(bedtimeFor(STATS[COMP_FOCUSED]!)).toBe("evening");
    expect(bedtimeFor(STATS[SOCIAL_GAME]!)).toBe("late-night"); // a night owl
    expect(bedtimeFor(STATS[BALANCED]!)).toBe("night");
  });

  it("is pure — the same stats always yield the same bedtime", () => {
    expect(bedtimeFor(STATS[SOCIAL_GAME]!)).toBe(bedtimeFor({ ...STATS[SOCIAL_GAME]! }));
  });

  it("awake through your bedtime, asleep after", () => {
    expect(isAwakeAt("evening", "night")).toBe(true);
    expect(isAwakeAt("night", "night")).toBe(true);
    expect(isAwakeAt("late-night", "night")).toBe(false); // bedtime night ⇒ asleep by late-night
    expect(isAwakeAt("late-night", "late-night")).toBe(true); // a night owl is still up
  });
});

describe("the diegetic bound — the house thins to (at most) the player + night owls", () => {
  const active = [PLAYER, COMP_FOCUSED, SOCIAL_GAME, BALANCED];
  const awakeAt = (phase: TimeOfDay, playerRetired = false): string[] =>
    awakeSet({ active, phase, player: PLAYER, playerRetired, bedtimeOf });

  it("everyone is up early; the set shrinks monotonically as the night gets late", () => {
    const sizes = TIME_OF_DAY_ORDER.map((p) => awakeAt(p).length);
    // morning … late-night — never grows
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
    expect(awakeAt("morning").length).toBe(4); // full house
  });

  it("by late-night only the player and the night owl remain awake", () => {
    expect(awakeAt("late-night").sort()).toEqual([PLAYER, SOCIAL_GAME].sort());
    expect(awakeAt("late-night")).not.toContain(COMP_FOCUSED); // bedded at evening
    expect(awakeAt("late-night")).not.toContain(BALANCED);     // bedded at night
  });

  it("the player is never auto-slept — they are awake until they choose to turn in", () => {
    expect(awakeAt("late-night")).toContain(PLAYER);
    expect(awakeAt("late-night", /* playerRetired */ true)).not.toContain(PLAYER);
  });

  it("every NPC has a latest bedtime, so without the player the house DOES fully empty", () => {
    const npcs = active.filter((id) => id !== PLAYER);
    const npcAwakeLate = npcs.filter((id) => isAwakeAt("late-night", bedtimeOf(id)));
    // only the night owl is up; push one phase past the last phase and even owls are abed by morning
    expect(npcAwakeLate).toEqual([SOCIAL_GAME]);
    expect(npcs.every((id) => isAwakeAt(bedtimeOf(id), bedtimeOf(id)))).toBe(true);
  });
});

describe("sleep is consequential — the rest deficit + the player's own cue are monotonic in lateness", () => {
  it("staying up later never lowers the hidden rest deficit, and late-night is the worst", () => {
    const deficits = TIME_OF_DAY_ORDER.map(restDeficitFor);
    for (let i = 1; i < deficits.length; i++) expect(deficits[i]!).toBeGreaterThanOrEqual(deficits[i - 1]!);
    expect(restDeficitFor("evening")).toBe(0);           // a healthy night — no penalty
    expect(restDeficitFor("late-night")).toBeGreaterThan(0); // a real cost
    expect(restDeficitFor("late-night")).toBe(Math.max(...deficits));
  });

  it("the player's own tiredness cue is qualitative — rested → tired → running on empty", () => {
    expect(restStatusFor("evening")).toBe("rested");
    expect(restStatusFor("afternoon")).toBe("rested");
    expect(restStatusFor("night")).toBe("tired");
    expect(restStatusFor("late-night")).toBe("running on empty");
  });

  it("phaseIndex orders the day", () => {
    expect(phaseIndex("morning")).toBe(0);
    expect(phaseIndex("late-night")).toBe(4);
  });
});
