import { describe, it, expect } from "vitest";
import {
  TIME_OF_DAY_ORDER, nextPhase, isLateNight, phaseIndex, phaseForHour,
  bedtimeFor, bedtimeHourFor, isAwakeAtHour, awakeSet,
  sleepDebtHours, sleepDeficitForBedHour, restDeficitForDepth, restStatusForDeficit, restStatusFor,
  WAKE_HOUR, DAY_END_HOUR,
} from "../../src/engine/timeOfDay";
import { CLOCK, SLEEP } from "../../src/engine/sleepConstants";

/**
 * 0066 — the PURE 24-hour time/sleep model (#1125). Roles only: the player, a comp-focused houseguest
 * (high physical, low social → an early lark), a social-game houseguest (high social, low physical → a
 * post-midnight owl), a balanced NPC. A day runs from the 8am forced wake (hour 8) to the next 8am
 * (hour 32); midnight is hour 24; the 8-hour sleep need is measured against the fixed 8am wake.
 */
const PLAYER = "player";
const LARK = "comp-focused";   // high physical, low social → beds early (pre-midnight)
const OWL = "social-game";     // high social, low physical → beds post-midnight (real debt)
const BALANCED = "balanced";

const STATS: Record<string, { physical: number; social: number }> = {
  [LARK]: { physical: 0.9, social: 0.2 },
  [OWL]: { physical: 0.2, social: 0.9 },
  [BALANCED]: { physical: 0.6, social: 0.6 },
};

describe("the 24-hour clock — five phases as hour bands (ADR 0006, #1125)", () => {
  it("has the five public phases in morning→late-night order", () => {
    expect([...TIME_OF_DAY_ORDER]).toEqual(["morning", "afternoon", "evening", "night", "late-night"]);
  });

  it("projects clock-hours onto the right phase band (8–12 morning … 24–32 late-night)", () => {
    expect(phaseForHour(8)).toBe("morning");    // the 8am wake
    expect(phaseForHour(11.5)).toBe("morning");
    expect(phaseForHour(12)).toBe("afternoon");
    expect(phaseForHour(16)).toBe("evening");
    expect(phaseForHour(20)).toBe("night");
    expect(phaseForHour(24)).toBe("late-night"); // midnight
    expect(phaseForHour(31.9)).toBe("late-night");
    expect(phaseForHour(2)).toBe("morning");     // clamped below the wake
    expect(phaseForHour(40)).toBe("late-night"); // clamped above the day
  });

  it("nextPhase advances one band and CLAMPS at late-night (a new day is the explicit 8am wake)", () => {
    expect(nextPhase("morning")).toBe("afternoon");
    expect(nextPhase("night")).toBe("late-night");
    expect(nextPhase("late-night")).toBe("late-night"); // clamp — never silently wraps
    expect(isLateNight("late-night")).toBe(true);
    expect(isLateNight("evening")).toBe(false);
    expect(phaseIndex("morning")).toBe(0);
    expect(phaseIndex("late-night")).toBe(4);
  });

  it("the day spans the 8am wake to the next 8am (24 hours)", () => {
    expect(WAKE_HOUR).toBe(8);
    expect(DAY_END_HOUR).toBe(32);
    expect(DAY_END_HOUR - WAKE_HOUR).toBe(CLOCK.dayLengthHours);
  });
});

describe("bedtimes are character-driven HOURS, deterministic, byte-stable", () => {
  it("the comp-focused bed early (pre-midnight); the social game beds late (post-midnight)", () => {
    const lark = bedtimeHourFor(STATS[LARK]!);
    const owl = bedtimeHourFor(STATS[OWL]!);
    expect(owl).toBeGreaterThan(lark);
    expect(lark).toBeLessThan(CLOCK.midnightHour);    // a lark beds before midnight (earns a pre-dawn window)
    expect(owl).toBeGreaterThan(CLOCK.midnightHour);  // an owl beds after midnight (pays debt)
    for (const s of Object.values(STATS)) {
      const h = bedtimeHourFor(s);
      expect(h).toBeGreaterThanOrEqual(SLEEP.earliestBedHour);
      expect(h).toBeLessThanOrEqual(SLEEP.latestBedHour);
    }
  });

  it("is pure — the same stats (and id) always yield the same bedtime hour", () => {
    expect(bedtimeHourFor(STATS[OWL]!)).toBe(bedtimeHourFor({ ...STATS[OWL]! }));
    expect(bedtimeHourFor(STATS[OWL]!, "x")).toBe(bedtimeHourFor(STATS[OWL]!, "x"));
    expect(bedtimeHourFor(STATS[BALANCED]!, "a")).not.toBe(bedtimeHourFor(STATS[BALANCED]!, "b")); // id spreads
  });

  it("the coarse phase bedtime still projects (the lark in evening/night, the owl in late-night)", () => {
    expect(["evening", "night"]).toContain(bedtimeFor(STATS[LARK]!));
    expect(bedtimeFor(STATS[OWL]!)).toBe("late-night");
  });
});

describe("the BIDIRECTIONAL awake set — shrinks toward midnight, GROWS toward the 8am wake", () => {
  it("a houseguest is awake before bed, asleep for 8h, then up again pre-dawn if they bedded early", () => {
    const larkBed = 22; // beds 10pm → sleeps to 6am (hour 30) → up again 30..32
    expect(isAwakeAtHour(20, larkBed)).toBe(true);   // 8pm: up
    expect(isAwakeAtHour(23, larkBed)).toBe(false);  // 11pm: asleep
    expect(isAwakeAtHour(28, larkBed)).toBe(false);  // 4am: still asleep
    expect(isAwakeAtHour(30, larkBed)).toBe(true);   // 6am: risen (pre-dawn window)
    expect(isAwakeAtHour(31, larkBed)).toBe(true);   // 7am: up

    const owlBed = 26; // beds 2am → would sleep to 10am but force-woken at 8am
    expect(isAwakeAtHour(25, owlBed)).toBe(true);    // 1am: still up
    expect(isAwakeAtHour(27, owlBed)).toBe(false);   // 3am: asleep
    expect(isAwakeAtHour(31, owlBed)).toBe(false);   // 7am: still asleep (no pre-dawn window — bedded late)
  });

  it("the awake set SHRINKS evening→midnight then GROWS midnight→pre-dawn (two distinct windows)", () => {
    const active = [PLAYER, LARK, OWL, BALANCED];
    const bedtimeOf = (id: string): number => bedtimeHourFor(STATS[id]!, id);
    const awakeAt = (hour: number, playerRetired = false): string[] =>
      awakeSet({ active, hour, player: PLAYER, playerRetired, bedtimeOf });

    const evening = awakeAt(18).length;      // 6pm — full or near-full house
    const preMidnight = awakeAt(23).length;  // 11pm — larks have turned in
    const deepNight = awakeAt(27).length;    // 3am — the trough (owls down, larks not yet up)
    const preDawn = awakeAt(31).length;      // 7am — larks have risen again
    expect(preMidnight).toBeLessThanOrEqual(evening);  // shrinks into the night
    expect(deepNight).toBeLessThanOrEqual(preMidnight);
    expect(preDawn).toBeGreaterThanOrEqual(deepNight); // GROWS back toward the wake (the bidirectional ramp)
    expect(awakeAt(8).length).toBe(4);                 // the 8am wake — everyone up
  });

  it("the player is never auto-slept — awake until they choose to turn in", () => {
    const active = [PLAYER, LARK, OWL];
    const bedtimeOf = (id: string): number => bedtimeHourFor(STATS[id]!, id);
    expect(awakeSet({ active, hour: 27, player: PLAYER, playerRetired: false, bedtimeOf })).toContain(PLAYER);
    expect(awakeSet({ active, hour: 27, player: PLAYER, playerRetired: true, bedtimeOf })).not.toContain(PLAYER);
  });
});

describe("sleep debt — graded, symmetric, against the 8am wake", () => {
  it("bed at/before midnight ⇒ 0 debt; bed after ⇒ hours past midnight, capped", () => {
    expect(sleepDebtHours(22)).toBe(0);           // 10pm — a healthy night (even a pre-dawn riser)
    expect(sleepDebtHours(CLOCK.midnightHour)).toBe(0); // midnight — exactly 8h to the wake
    expect(sleepDebtHours(26)).toBe(2);           // 2am — 2 hours of sleep lost
    expect(sleepDebtHours(30)).toBe(6);           // 6am — 6 hours past midnight
    expect(sleepDebtHours(DAY_END_HOUR)).toBe(SLEEP.maxDebtHours); // up to the 8am wake — capped at the max (8h)
  });

  it("the graded deficit (0..1) is 0 for a healthy night and ramps to 1 for a full night up", () => {
    expect(sleepDeficitForBedHour(22)).toBe(0);
    expect(sleepDeficitForBedHour(24)).toBe(0);
    expect(sleepDeficitForBedHour(26)).toBeGreaterThan(0);
    expect(sleepDeficitForBedHour(26)).toBeLessThan(1);
    expect(sleepDeficitForBedHour(DAY_END_HOUR)).toBeCloseTo(1);
    // monotonic in lateness (never lower for a later bedtime)
    let prev = -1;
    for (let h = 20; h <= 32; h += 0.5) {
      const d = sleepDeficitForBedHour(h);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    // restDeficitForDepth is the same graded read off the clock-hour last awake (back-compat name)
    expect(restDeficitForDepth(26)).toBe(sleepDeficitForBedHour(26));
  });

  it("the player's own cue is qualitative — rested → tired → running on empty (their own body only)", () => {
    expect(restStatusForDeficit(0)).toBe("rested");
    expect(restStatusForDeficit(0.3)).toBe("tired");
    expect(restStatusForDeficit(0.8)).toBe("running on empty");
    // restStatusFor maps a clock-hour through the deficit
    expect(restStatusFor(22)).toBe("rested");      // bed 10pm
    expect(restStatusFor(DAY_END_HOUR)).toBe("running on empty"); // up to the bitter end
  });
});
