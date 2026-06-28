import { describe, it, expect } from "vitest";
import { resolveCompetition, CompetitionIntents, type Competitor } from "../../src/domain/competitionOutcome";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { sleepDeficitForBedHour, bedtimeHourFor } from "../../src/engine/timeOfDay";
import { CLOCK } from "../../src/engine/sleepConstants";
import { npcRestDeficit } from "../../src/engine/liveSeason";
import type { LiveSeasonState } from "../../src/engine/liveSeason";
import { ARCHETYPES } from "../../src/engine/characterFactory";

/**
 * ENG-NEW-1 (the 24-hour model, #1125) — the clock-ON sleep economy is FAIR: the hidden sleep deficit must
 * NOT be a structural tax on an archetype (anti-sycophancy: the engine never systematically advantages or
 * disadvantages a kind of player). The deficit is keyed off the ACTUAL night — the EARLIER of a houseguest's
 * character bedtime HOUR and how late the night actually RAN (the clock-hour the house stayed up to) — so a
 * normal night (the house turned in by midnight) costs EVERY archetype nothing, and only a night-owl who
 * genuinely stayed up past midnight pays. Roles only — archetypes are stat patterns, no names.
 *
 * This is the gate the deploy path (clock-ON) needs — the juryReach band runs clock-OFF.
 */

// A minimal live state the rest read consumes: `lastSleepDepth` is the clock-HOUR the night ran to.
// A "normal night" ran to ~midnight (hour 24); a "late night" ran into the small hours (hour 30).
const NORMAL_NIGHT: LiveSeasonState = { lastSleepDepth: CLOCK.midnightHour } as LiveSeasonState; // ran to midnight
const EARLY_NIGHT: LiveSeasonState = { lastSleepDepth: 22 } as LiveSeasonState;                  // house bed by 10pm
const LATE_NIGHT: LiveSeasonState = { lastSleepDepth: 30 } as LiveSeasonState;                   // ran into the small hours

describe("ENG-NEW-1 — sleep debt only past midnight (the graded hour curve)", () => {
  it("bed by midnight carries NO deficit; only a post-midnight hour costs sharpness", () => {
    expect(sleepDeficitForBedHour(22)).toBe(0);                  // 10pm — healthy
    expect(sleepDeficitForBedHour(CLOCK.midnightHour)).toBe(0);  // midnight — exactly enough sleep
    expect(sleepDeficitForBedHour(26)).toBeGreaterThan(0);       // 2am — a real cost
  });
});

describe("ENG-NEW-1 — no archetype tax: a NORMAL night costs every archetype nothing", () => {
  it("every shipped archetype carries ZERO deficit when the house turned in by midnight", () => {
    for (const a of ARCHETYPES) {
      expect(npcRestDeficit(NORMAL_NIGHT, a.bias), `archetype ${a.archetype} must carry no normal-night tax`).toBe(0);
    }
  });

  it("the mental favorites (high mental) are no longer penalized on a normal night", () => {
    const mentalFavorites = ARCHETYPES.filter((a) => a.bias.mental >= 0.75);
    expect(mentalFavorites.length).toBeGreaterThanOrEqual(2);
    for (const a of mentalFavorites) expect(npcRestDeficit(NORMAL_NIGHT, a.bias)).toBe(0);
  });
});

describe("ENG-NEW-1 — the deficit is DYNAMIC on the actual night, only biting a real late night", () => {
  it("only a night-owl who actually stayed up PAST MIDNIGHT carries a deficit on a late night", () => {
    for (const a of ARCHETYPES) {
      const isOwl = bedtimeHourFor(a.bias) > CLOCK.midnightHour; // their chronotype keeps them up past midnight
      const deficit = npcRestDeficit(LATE_NIGHT, a.bias);
      if (isOwl) expect(deficit).toBeGreaterThan(0); // genuinely up late — an EARNED cost
      else expect(deficit).toBe(0);                  // they bedded before midnight — the late night didn't touch them
    }
  });

  it("a night-owl pays ONLY on a late night they were actually awake through, never on a normal one", () => {
    const owl = { physical: 0.2, social: 0.9 }; // a clear owl — chronotype runs past midnight
    expect(bedtimeHourFor(owl)).toBeGreaterThan(CLOCK.midnightHour);
    expect(npcRestDeficit(NORMAL_NIGHT, owl)).toBe(0); // house turned in by midnight ⇒ nothing
    expect(npcRestDeficit(EARLY_NIGHT, owl)).toBe(0);  // house turned in early ⇒ nothing
    expect(npcRestDeficit(LATE_NIGHT, owl)).toBeGreaterThan(0); // they ran into the small hours ⇒ a cost
  });

  it("PROPERTY: for any stats, a night that ended by midnight is always cost-free", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = new SeededRandom(seed);
      const stats = { physical: rng.next(), social: rng.next() };
      expect(npcRestDeficit(NORMAL_NIGHT, stats)).toBe(0);
    }
  });
});

describe("ENG-NEW-1 — the clock-ON path: a mental favorite is not sleep-suppressed in their comp", () => {
  it("on a normal night, a mental favorite wins a mental comp a clear majority (no tax)", () => {
    const N = 400;
    const mastermind = ARCHETYPES.find((a) => a.archetype === "mastermind")!;
    const favorite: Competitor = {
      id: "favorite",
      stats: { physical: mastermind.bias.physical, mental: mastermind.bias.mental, social: mastermind.bias.social },
      restPenalty: npcRestDeficit(NORMAL_NIGHT, mastermind.bias),
    };
    const even: Competitor = { id: "even", stats: { physical: 0.5, mental: 0.5, social: 0.5 }, restPenalty: 0 };
    let favWins = 0;
    for (let seed = 0; seed < N; seed++) {
      const r = resolveCompetition([favorite, even], "mental", new CompetitionIntents(), new SeededRandom(seed));
      if (r.winner === favorite.id) favWins++;
    }
    expect(favWins / N).toBeGreaterThan(0.6); // the mental edge wins out — sleep doesn't quietly suppress it
    expect(favorite.restPenalty).toBe(0);     // and it paid no normal-night sleep tax to get there
  });
});
