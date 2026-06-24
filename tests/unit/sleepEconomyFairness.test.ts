import { describe, it, expect } from "vitest";
import { resolveCompetition, CompetitionIntents, type Competitor } from "../../src/domain/competitionOutcome";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { restDeficitFor, bedtimeDepthFor } from "../../src/engine/timeOfDay";
import { npcRestDeficit } from "../../src/engine/liveSeason";
import type { LiveSeasonState } from "../../src/engine/liveSeason";
import { ARCHETYPES } from "../../src/engine/characterFactory";

/**
 * ENG-NEW-1 — the clock-ON sleep economy is FAIR: the hidden rest deficit must NOT be a structural
 * tax on an archetype (anti-sycophancy: the engine never systematically advantages or disadvantages
 * a kind of player). The old model `restDeficitFor(bedtimeFor(stats))` keyed the deficit purely on
 * `social − physical`, so 5 of the 12 shipped archetypes — including the MENTAL favorites (mastermind,
 * analyst) — carried the maximum penalty in EVERY competition (the mental comps they should win
 * included), regardless of how the night actually went. The deficit is now keyed off the ACTUAL night
 * (the earlier of a houseguest's character bedtime and how far the night ran), so it only bites a
 * night-owl who genuinely stayed up to late-night. Roles only — archetypes are stat patterns, no names.
 *
 * This is the gate the deploy path (clock-ON) previously LACKED — the juryReach band runs clock-OFF.
 */

// A minimal live state the rest read consumes: the continuous `lastSleepDepth` (how deep last night ran).
// Mapped from a phase to a representative depth so the night-vs-late-night intent reads clearly.
const DEPTH_OF: Record<string, number> = { morning: 0.1, afternoon: 0.3, evening: 0.5, night: 0.78, "late-night": 1.0 };
const nightOf = (phase: NonNullable<LiveSeasonState["lastSleepPhase"]>): LiveSeasonState =>
  ({ lastSleepDepth: DEPTH_OF[phase] } as LiveSeasonState);

describe("ENG-NEW-1 — the rest deficit table matches its own design (the night⇒0 contradiction)", () => {
  it("a healthy night (bed by `night`) carries NO deficit; only `late-night` costs sharpness", () => {
    // The audit falsifier: `restDeficitFor("night")` used to return 0.25 against the comment's 0.
    expect(restDeficitFor("night")).toBe(0);
    expect(restDeficitFor("evening")).toBe(0);
    expect(restDeficitFor("late-night")).toBeGreaterThan(0);
  });
});

describe("ENG-NEW-1 — no archetype tax: a NORMAL night costs every archetype nothing", () => {
  it("every shipped archetype carries ZERO deficit when the night bedded by `night`", () => {
    // The OLD model taxed 5 of these 12 at the maximum (mastermind, social-butterfly, flirt, loyalist,
    // peacemaker) and 4 more at a fraction — a pure function of social−physical. The new model: none.
    const normalNight = nightOf("night");
    for (const a of ARCHETYPES) {
      expect(npcRestDeficit(normalNight, a.bias), `archetype ${a.archetype} must carry no normal-night tax`).toBe(0);
    }
  });

  it("the mental favorites (high mental) are no longer penalized on a normal night", () => {
    const normalNight = nightOf("night");
    const mentalFavorites = ARCHETYPES.filter((a) => a.bias.mental >= 0.75); // mastermind, analyst, villain
    expect(mentalFavorites.length).toBeGreaterThanOrEqual(2);
    for (const a of mentalFavorites) expect(npcRestDeficit(normalNight, a.bias)).toBe(0);
  });
});

describe("ENG-NEW-1 — the deficit is DYNAMIC on the actual night, only biting a real late night", () => {
  it("only a night-owl who actually stayed up INTO `late-night` carries a deficit", () => {
    const lateNight = nightOf("late-night");
    for (const a of ARCHETYPES) {
      const isOwl = bedtimeDepthFor(a.bias) > 0.8; // their chronotype keeps them up into the small hours
      const deficit = npcRestDeficit(lateNight, a.bias);
      if (isOwl) expect(deficit).toBeGreaterThan(0); // they were genuinely up late — an EARNED cost
      else expect(deficit).toBe(0);                  // they bedded by `night` — the late night didn't touch them
    }
  });

  it("a night-owl pays ONLY on a late night they were actually awake through, never on a normal one", () => {
    const owl = { physical: 0.2, social: 0.9 }; // a clear owl (social ≫ physical) — chronotype runs deep
    expect(bedtimeDepthFor(owl)).toBeGreaterThan(0.8);
    expect(npcRestDeficit(nightOf("night"), owl)).toBe(0);          // normal night ⇒ nothing
    expect(npcRestDeficit(nightOf("evening"), owl)).toBe(0);        // the house turned in early ⇒ nothing
    expect(npcRestDeficit(nightOf("late-night"), owl)).toBeGreaterThan(0); // they ran to the end ⇒ a cost
  });

  it("PROPERTY: for any stats, a normal night (bed by `night`) is always cost-free", () => {
    const normalNight = nightOf("night");
    for (let seed = 0; seed < 200; seed++) {
      const rng = new SeededRandom(seed);
      const stats = { physical: rng.next(), social: rng.next() };
      expect(npcRestDeficit(normalNight, stats)).toBe(0);
    }
  });
});

describe("ENG-NEW-1 — the clock-ON path: a mental favorite is not sleep-suppressed in their comp", () => {
  it("on a normal night, a mental favorite wins a mental comp a clear majority (no tax)", () => {
    const N = 400;
    const mastermind = ARCHETYPES.find((a) => a.archetype === "mastermind")!;
    const normalNight = nightOf("night");
    // The mental favorite carries the deficit the live clock-ON path would feed the fold (now 0).
    const favorite: Competitor = {
      id: "favorite",
      stats: { physical: mastermind.bias.physical, mental: mastermind.bias.mental, social: mastermind.bias.social },
      restPenalty: npcRestDeficit(normalNight, mastermind.bias),
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
