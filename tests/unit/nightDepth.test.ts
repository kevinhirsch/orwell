import { describe, it, expect } from "vitest";
import {
  phaseForDepth, bedtimeDepthFor, restDeficitForDepth, TIME_OF_DAY_ORDER,
} from "../../src/engine/timeOfDay";
import { advanceClock, playerTurnIn, playerRestDeficit, npcRestDeficit } from "../../src/engine/liveSeason";
import type { LiveSeasonState } from "../../src/engine/liveSeason";

/**
 * 0066 Phase-2 — the hidden continuous "night depth" that grades the sleep trade + varies bedtimes by
 * chronotype, PROJECTED onto the public 5-phase enum. Everything here is gated: with no clock running
 * (no `nightDepth` / `lastSleepDepth`) every read is 0 ⇒ byte-identical to the pre-feature model. No rng:
 * a bedtime is DERIVED deterministically, never rolled. Roles only — no names, no fixed cast.
 */

describe("phaseForDepth — projects the hidden depth onto the public 5 phases (monotonic)", () => {
  it("0 = morning, 1 = late-night, and the projection never goes backwards", () => {
    expect(phaseForDepth(0)).toBe("morning");
    expect(phaseForDepth(1)).toBe("late-night");
    expect(phaseForDepth(-5)).toBe("morning"); // clamped
    expect(phaseForDepth(5)).toBe("late-night");
    let last = -1;
    for (let d = 0; d <= 1.0001; d += 0.02) {
      const idx = TIME_OF_DAY_ORDER.indexOf(phaseForDepth(d));
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });
});

describe("bedtimeDepthFor — chronotype is its OWN axis, deterministic, byte-stable", () => {
  it("is in range, and a social houseguest beds deeper than a comp-focused one", () => {
    const owl = bedtimeDepthFor({ physical: 0.2, social: 0.9 });
    const lark = bedtimeDepthFor({ physical: 0.9, social: 0.2 });
    expect(owl).toBeGreaterThan(lark);
    for (const s of [{ physical: 0, social: 1 }, { physical: 1, social: 0 }, { physical: 0.5, social: 0.5 }]) {
      const d = bedtimeDepthFor(s);
      expect(d).toBeGreaterThanOrEqual(0.45);
      expect(d).toBeLessThanOrEqual(0.95);
    }
  });

  it("the per-id variation is DETERMINISTIC (same id ⇒ same) and SPREADS similar-stat houseguests apart", () => {
    const stats = { physical: 0.5, social: 0.5 };
    expect(bedtimeDepthFor(stats, "hg-A")).toBe(bedtimeDepthFor(stats, "hg-A")); // no rng — stable
    const a = bedtimeDepthFor(stats, "hg-A");
    const b = bedtimeDepthFor(stats, "hg-B");
    expect(a).not.toBe(b); // two identical-stat houseguests still differ (its own axis)
    // and omitting the id is the legacy pure-stats shape (no variation)
    expect(bedtimeDepthFor(stats)).not.toBe(a);
  });
});

describe("restDeficitForDepth — graded, only within late-night (preserves the no-normal-night-tax invariant)", () => {
  it("0 through `night` (≤0.8), then ramps to 1 at the bitter end, monotonically", () => {
    expect(restDeficitForDepth(0.5)).toBe(0);
    expect(restDeficitForDepth(0.8)).toBe(0); // a healthy night is free
    expect(restDeficitForDepth(0.9)).toBeGreaterThan(0);
    expect(restDeficitForDepth(1.0)).toBeCloseTo(1);
    let prev = -1;
    for (let d = 0; d <= 1.0001; d += 0.05) {
      const v = restDeficitForDepth(d);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("advanceClock — advances the hidden depth, projects the phase, wraps at the bitter end", () => {
  it("rolls over several beats (no whole-phase lurch) and a full night banks the max deficit", () => {
    const s = {} as LiveSeasonState;
    advanceClock(s); // first beat starts the morning
    expect(s.timeOfDay).toBe("morning");
    expect(s.nightDepth).toBe(0);
    let beats = 0;
    while (s.timeOfDay !== "late-night" && beats < 50) { advanceClock(s); beats++; }
    expect(beats).toBeGreaterThan(3); // a phase takes MORE than one beat now (the cadence fix)
    // run out the night without the player turning in ⇒ wrap to morning, banked running-on-empty
    for (let i = 0; i < 50 && s.nightDepth !== 0; i++) advanceClock(s);
    expect(s.timeOfDay).toBe("morning");
    expect(s.lastSleepDepth).toBe(1);
    expect(playerRestDeficit(s)).toBeCloseTo(1); // outlasted the whole house ⇒ max deficit
  });

  it("the player's bedtime lever grades the deficit by how deep they were up", () => {
    const early = { nightDepth: 0.5, evictionOrder: [] } as unknown as LiveSeasonState; // bedded by evening
    playerTurnIn(early, "player");
    expect(early.timeOfDay).toBe("morning");
    expect(playerRestDeficit(early)).toBe(0); // an early night ⇒ rested

    const late = { nightDepth: 0.95, evictionOrder: [] } as unknown as LiveSeasonState; // ran deep into late-night
    playerTurnIn(late, "player");
    expect(playerRestDeficit(late)).toBeGreaterThan(0); // a late night ⇒ a real cost
  });
});

describe("gated OFF ⇒ byte-identical: with no clock running every rest read is 0", () => {
  it("an absent depth means zero deficit for the player and every NPC", () => {
    const dormant = {} as LiveSeasonState; // no nightDepth / lastSleepDepth — the calibration spine
    expect(playerRestDeficit(dormant)).toBe(0);
    expect(npcRestDeficit(dormant, { physical: 0.2, social: 0.9 }, "owl")).toBe(0);
    expect(npcRestDeficit(dormant, { physical: 0.9, social: 0.2 }, "lark")).toBe(0);
  });
});
