import { describe, it, expect } from "vitest";
import {
  eventSpanHours, eventStartHour, eventSpillsPeriod, PERIOD_HOURS, WAKE_HOUR,
} from "../../src/engine/timeOfDay";
import { EVENT_DURATION, CLOCK } from "../../src/engine/sleepConstants";

/**
 * 0066 (#1125) — event durations + SEEDED start-within-period. A timed beat (comp/ceremony/eviction) has a
 * typical duration, starts at a DETERMINISTIC offset WITHIN its 4-hour period (NOT pinned to the edge), may
 * SPILL into the next period, and comps vary BY TYPE. The start offset hashes seed + beat-key and draws NO
 * shared-stream rng (the seeded comp/vote spine is untouched — when, in-fiction, a comp "starts" never
 * changes who wins). Roles only.
 */

describe("event durations — comp ~3h, ceremony ~1h, eviction ~2h, comps vary by type", () => {
  it("the defaults match the model (comp 3h · ceremony 1h · eviction 2h)", () => {
    expect(eventSpanHours("competition")).toBe(EVENT_DURATION.hoursByBeat.competition);
    expect(eventSpanHours("ceremony")).toBe(EVENT_DURATION.hoursByBeat.ceremony);
    expect(eventSpanHours("eviction")).toBe(EVENT_DURATION.hoursByBeat.eviction);
    expect(eventSpanHours("competition")).toBe(3);
    expect(eventSpanHours("ceremony")).toBe(1);
    expect(eventSpanHours("eviction")).toBe(2);
  });

  it("comps vary BY TYPE via the 0042 library override (endurance long, quick-fire short)", () => {
    expect(eventSpanHours("competition", 5)).toBe(5);    // an endurance comp runs long
    expect(eventSpanHours("competition", 1.5)).toBe(1.5); // a quick-fire comp is short
    // a malformed/zero override falls back to the default (never 0)
    expect(eventSpanHours("competition", 0)).toBe(3);
    expect(eventSpanHours("competition", Number.NaN)).toBe(3);
  });
});

describe("seeded start-within-period — deterministic, varied, NOT pinned to the edge", () => {
  const periodStart = CLOCK.phaseStartsHour.morning; // 8am (the HOH/noms/ceremony period)

  it("the start falls WITHIN the period's seeded window and is replay-stable per seed+beat", () => {
    for (const seed of [1, 7, 42, 99]) {
      const start = eventStartHour(periodStart, seed, "hoh:w1");
      expect(start).toBeGreaterThanOrEqual(periodStart);
      expect(start).toBeLessThan(periodStart + PERIOD_HOURS * EVENT_DURATION.startWindowFrac);
      expect(eventStartHour(periodStart, seed, "hoh:w1"), "same seed+beat ⇒ same start (replay)").toBe(start);
    }
  });

  it("is NOT pinned to the period edge: different beats/seeds land at different offsets", () => {
    const a = eventStartHour(periodStart, 7, "hoh:w1");
    const b = eventStartHour(periodStart, 7, "veto:w1"); // a different beat key
    const c = eventStartHour(periodStart, 8, "hoh:w1");   // a different seed
    expect(a).not.toBe(periodStart); // not pinned to the edge (with overwhelming probability)
    expect(a).not.toBe(b);           // distinct beats start at distinct in-fiction times
    expect(a).not.toBe(c);           // distinct seeds vary the start
  });
});

describe("spillover — a beat may run past its period boundary", () => {
  it("a long comp starting late in its period spills into the next period", () => {
    // a 3-hour comp starting 2h into a 4-hour period ends 1h into the NEXT period.
    const periodStart = CLOCK.phaseStartsHour.afternoon; // 12pm (the veto-comp period)
    const startLate = periodStart + 2; // 2pm
    expect(eventSpillsPeriod(startLate, eventSpanHours("competition"))).toBe(true);  // 2pm + 3h = 5pm > 4pm
    const startEarly = periodStart + 0.5; // 12:30
    expect(eventSpillsPeriod(startEarly, eventSpanHours("ceremony"))).toBe(false);   // 12:30 + 1h = 1:30 < 4pm
  });

  it("the period boundary is the 4-hour grid from the 8am wake", () => {
    expect(PERIOD_HOURS).toBe(4);
    expect(WAKE_HOUR).toBe(8);
    // a beat exactly filling its period does not spill; one hour longer does.
    expect(eventSpillsPeriod(8, 4)).toBe(false);
    expect(eventSpillsPeriod(8, 4.5)).toBe(true);
  });
});
