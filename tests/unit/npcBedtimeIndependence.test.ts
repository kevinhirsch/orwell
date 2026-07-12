import { describe, it, expect } from "vitest";
import { emergentBedtimeHour, restDeficitForDepth } from "../../src/engine/timeOfDay";
import { CLOCK, AFTER_HOURS } from "../../src/engine/sleepConstants";
import { npcRestDeficit } from "../../src/engine/liveSeason";
import type { LiveSeasonState } from "../../src/engine/liveSeason";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * 0066 Extension 4 — EMERGENT, INDEPENDENT NPC bedtimes (the fairness fix, owner 2026-07-12). Sleep debt
 * must be incurred on the SAME footing for an NPC as for the player: driven by how late THEY were up, not
 * capped at the player's own bedtime — but WITHOUT a flat archetype tax (a social/owl NPC always tired). A
 * night-owl lingers to their chronotype bedtime ONLY with late-night COMPANY (other natural owls up) or a
 * house the player kept up; ALONE on a dead night they wind down to the social floor and pay nothing.
 *
 * Roles only — an "owl" is a late chronotype (bedtime past midnight), a "lark" an early one. All bedtimes
 * are passed explicitly (no names, no hidden fixtures). Pure + deterministic — no rng in the mechanic.
 */

const MIDNIGHT = CLOCK.midnightHour;       // 24
const OWL = 26;                            // chronotype 2am — a real late-night owl
const LARK = 21;                           // chronotype 9pm — beds well before midnight

// Old (pre-Extension-4) player-capped deficit — the byte-identity reference the calibration spine relied on.
const oldCappedDeficit = (bedHour: number, nightEnd: number) => restDeficitForDepth(Math.min(bedHour, nightEnd));

describe("emergentBedtimeHour — the pure mechanic", () => {
  it("a lark (beds before the social floor) keeps their own early bedtime, any company", () => {
    for (const company of [0, 1, 3, 10]) {
      expect(emergentBedtimeHour(LARK, company, /*nightEnd*/ 22)).toBe(LARK);
    }
  });

  it("an owl ALONE winds down to the social floor (midnight on an early/normal night) — no flat tax", () => {
    expect(emergentBedtimeHour(OWL, 0, /*player bed 10pm*/ 22)).toBe(MIDNIGHT);
    expect(emergentBedtimeHour(OWL, 0, /*normal, ~midnight*/ MIDNIGHT)).toBe(MIDNIGHT);
  });

  it("an owl WITH full company lingers all the way to their own chronotype bedtime", () => {
    expect(emergentBedtimeHour(OWL, AFTER_HOURS.companyFull, 22)).toBe(OWL);
  });

  it("a late house (the player kept everyone up) raises the floor — even a lone owl is carried up", () => {
    // nightEnd 30 (~6am) > the owl's own 26 ⇒ they bed at their chronotype, up late with the house.
    expect(emergentBedtimeHour(OWL, 0, 30)).toBe(OWL);
  });

  it("company interpolates monotonically between the floor and the owl's chronotype", () => {
    const lone = emergentBedtimeHour(OWL, 0, 22);
    const some = emergentBedtimeHour(OWL, 1, 22);
    const full = emergentBedtimeHour(OWL, AFTER_HOURS.companyFull, 22);
    expect(some).toBeGreaterThan(lone);
    expect(full).toBeGreaterThan(some);
  });
});

describe("npcRestDeficit — the fairness fix (independent of the player's bedtime)", () => {
  const stateEndingAt = (nightEnd: number): LiveSeasonState => ({ lastSleepDepth: nightEnd } as LiveSeasonState);

  it("an owl WITH company pays real debt even though the player bedded EARLY (the old model gave 0)", () => {
    const earlyNight = stateEndingAt(22); // the player turned in at 10pm
    // Fairness fix: with late-night company the owl still stayed up — and pays for it, independent of the player.
    expect(npcRestDeficit(earlyNight, { physical: 0.2, social: 0.9 }, "owl", OWL, AFTER_HOURS.companyFull))
      .toBeGreaterThan(0);
    // The OLD player-capped model erased it entirely (min(26, 22) = 22 ⇒ 0) — the asymmetry we removed.
    expect(oldCappedDeficit(OWL, 22)).toBe(0);
  });

  it("the SAME owl ALONE on that early night pays NOTHING — the debt is EARNED, never a flat tax", () => {
    const earlyNight = stateEndingAt(22);
    expect(npcRestDeficit(earlyNight, { physical: 0.2, social: 0.9 }, "owl", OWL, /*company*/ 0)).toBe(0);
  });

  it("a lark never pays, company or not", () => {
    const lateNight = stateEndingAt(30);
    expect(npcRestDeficit(lateNight, { physical: 0.9, social: 0.2 }, "lark", LARK, AFTER_HOURS.companyFull)).toBe(0);
  });

  it("no completed night yet ⇒ nobody carries debt (before the first night ends)", () => {
    expect(npcRestDeficit({} as LiveSeasonState, { physical: 0.2, social: 0.9 }, "owl", OWL, AFTER_HOURS.companyFull)).toBe(0);
  });

  it("BYTE-IDENTICAL when company is omitted: matches the pre-Extension-4 player-capped deficit", () => {
    for (const nightEnd of [10, 20, 22, 24, 25, 26, 28, 30, 32]) {
      const s = stateEndingAt(nightEnd);
      for (const bed of [LARK, MIDNIGHT, 25, OWL, 28]) {
        expect(npcRestDeficit(s, { physical: 0.5, social: 0.5 }, "x", bed), `nightEnd=${nightEnd} bed=${bed}`)
          .toBe(oldCappedDeficit(bed, Math.max(nightEnd, 0)));
      }
    }
  });

  it("PROPERTY: company-omitted is a fixed point of the old model across random bedtimes/nights", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = new SeededRandom(seed);
      const nightEnd = 20 + rng.next() * 14;   // ~20:00 → ~10am, a real completed night
      const bed = 21 + rng.next() * 9;         // ~21:00 → ~6am chronotype
      const s = { lastSleepDepth: nightEnd } as LiveSeasonState;
      expect(npcRestDeficit(s, { physical: 0.5, social: 0.5 }, "x", bed)).toBe(oldCappedDeficit(bed, nightEnd));
    }
  });
});
