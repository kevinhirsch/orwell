import { describe, it, expect } from "vitest";
import {
  phaseForDepth, bedtimeDepthFor, restDeficitForDepth, socialSwayScale, SOCIAL_SWAY_FLOOR,
  accrueFatigue, combinedRestDeficit, conversationClockCost, TIME_OF_DAY_ORDER,
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

describe("socialSwayScale — a tired houseguest sways the house LESS (effectiveness, floored)", () => {
  it("is 1 when rested (byte-identical), drops monotonically, and never below the floor", () => {
    expect(socialSwayScale(0)).toBe(1); // rested ⇒ no scaling ⇒ the off-screen fold is unchanged
    expect(socialSwayScale(1)).toBe(SOCIAL_SWAY_FLOOR);
    expect(socialSwayScale(2)).toBe(SOCIAL_SWAY_FLOOR);  // clamped
    let prev = 2;
    for (let d = 0; d <= 1.0001; d += 0.1) {
      const v = socialSwayScale(d);
      expect(v).toBeLessThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(SOCIAL_SWAY_FLOOR);
      prev = v;
    }
  });
});

describe("multi-night fatigue — a STRING of late nights compounds; a rested night recovers", () => {
  it("accrueFatigue stacks consecutive late nights toward 1 and decays when rested (bounded)", () => {
    // Moderate late nights (deficit 0.5 each) compound: a single one doesn't max you, but a string does.
    const n1 = accrueFatigue(0, 0.5);
    const n2 = accrueFatigue(n1, 0.5);
    const n3 = accrueFatigue(n2, 0.5);
    expect(n2).toBeGreaterThan(n1); // the second late night compounds beyond the first
    expect(n3).toBeGreaterThan(n2);
    expect(n3).toBeLessThanOrEqual(1); // bounded
    expect(accrueFatigue(1, 1)).toBe(1); // saturates, never exceeds 1
    const recovered = accrueFatigue(n3, 0); // a fully rested night
    expect(recovered).toBeLessThan(n3); // recovers
    expect(recovered).toBeGreaterThanOrEqual(0);
  });

  it("combinedRestDeficit adds the meter on top of the immediate deficit, bounded and monotonic", () => {
    expect(combinedRestDeficit(0, 0)).toBe(0);          // rested + no history ⇒ nothing (byte-identical)
    expect(combinedRestDeficit(0.3, 0)).toBe(0.3);      // no history ⇒ just the immediate
    expect(combinedRestDeficit(0.3, 0.8)).toBeGreaterThan(0.3); // accumulated fatigue adds on top
    expect(combinedRestDeficit(1, 1)).toBe(1);          // bounded
    expect(combinedRestDeficit(0, 0.5)).toBeGreaterThan(combinedRestDeficit(0, 0.2)); // monotonic in the meter
  });
});

describe("activity-aware time budget — a player conversation advances the clock by how long it takes", () => {
  it("conversationClockCost: a substantive scene reads longer than casual chat; both pass time", () => {
    expect(conversationClockCost("strategy")).toBeGreaterThan(conversationClockCost("bonding"));
    expect(conversationClockCost("alliance")).toBe(conversationClockCost("strategy"));
    expect(conversationClockCost("gossip")).toBe(conversationClockCost("bonding"));
    expect(conversationClockCost("bonding")).toBeGreaterThan(0);
  });

  it("advanceClock takes a per-activity step (a bigger activity moves the day more)", () => {
    const a = { nightDepth: 0.3, timeOfDay: "afternoon", evictionOrder: [] } as unknown as LiveSeasonState;
    advanceClock(a, 0.05);
    const b = { nightDepth: 0.3, timeOfDay: "afternoon", evictionOrder: [] } as unknown as LiveSeasonState;
    advanceClock(b, 0.12);
    expect(b.nightDepth! - 0.3).toBeGreaterThan(a.nightDepth! - 0.3); // the larger step advanced further
    expect(a.nightDepth).toBeCloseTo(0.35);
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
