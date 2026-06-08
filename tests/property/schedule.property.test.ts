import { describe, it, expect } from "vitest";
import { simulateSeasonSchedule, isMeaningful, weeksOf } from "../../src/engine/schedule";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

describe("daily-event invariant", () => {
  it("every day is meaningful; weeks are HOH reigns with at most one (still-meaningful) social day", () => {
    let totalWeeks = 0;
    let socialWeeks = 0;
    let socialDaysSeen = 0;

    for (let seed = 1; seed <= 20; seed++) {
      const days = simulateSeasonSchedule(new SeededRandom(seed), 16);
      expect(days.every(isMeaningful), `seed ${seed}: an empty day`).toBe(true);

      for (const week of weeksOf(days)) {
        totalWeeks++;
        expect(week[0]!.kind, `seed ${seed}`).toBe("hoh-comp");
        expect(week[week.length - 1]!.kind, `seed ${seed}`).toBe("eviction");
        const social = week.filter((d) => d.isSocial);
        expect(social.length).toBeLessThanOrEqual(1);
        if (social.length === 1) {
          socialWeeks++;
          socialDaysSeen++;
          expect(social[0]!.significantHouseEvent).toBe(true);
        }
      }
    }

    // "often none": social days are a minority of weeks, but they do occur.
    expect(socialWeeks).toBeLessThan(totalWeeks / 2);
    expect(socialDaysSeen).toBeGreaterThan(0);
  });
});
