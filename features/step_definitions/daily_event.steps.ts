import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { scheduleWeek, simulateSeasonSchedule, isMeaningful, weeksOf } from "../../src/engine/schedule";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

const WEEKS = 16;

// --- A single completed day ---------------------------------------------------

When("an in-game day completes", function (this: BbWorld) {
  this.weekDays = scheduleWeek(0, new SeededRandom(1));
  this.day = this.weekDays[2];
});

// regex: the step text contains "{...}".
Then(
  /^at least one of \{HOH competition, nominations, veto competition, veto ceremony, eviction, significant house event\} occurred$/,
  function (this: BbWorld) {
    assert.ok(isMeaningful(this.day!), "every completed day must carry a meaningful event");
  },
);

// --- A week is one HOH reign --------------------------------------------------

Given("a week begins with an HOH competition", function (this: BbWorld) {
  this.weekDays = scheduleWeek(0, new SeededRandom(3));
  assert.equal(this.weekDays[0]!.kind, "hoh-comp");
});

When("the week ends", function (this: BbWorld) {
  assert.ok(this.weekDays && this.weekDays.length > 0);
});

Then("it ends with an eviction", function (this: BbWorld) {
  assert.equal(this.weekDays![this.weekDays!.length - 1]!.kind, "eviction");
});

Then("the number of in-game days in the week may vary", function (this: BbWorld) {
  const n = this.weekDays!.length;
  assert.ok(n === 5 || n === 6, `a week is 5–6 days (not a fixed 7), got ${n}`);
});

// --- No empty days over a seeded season ---------------------------------------

Given("a season is simulated with seed {string}", function (this: BbWorld, seed: string) {
  this.scheduleDays = simulateSeasonSchedule(new SeededRandom(Number(seed)), WEEKS);
});

Then("every completed in-game day contains at least one meaningful event", function (this: BbWorld) {
  assert.ok(this.scheduleDays!.every(isMeaningful), "no day may be empty");
});

// --- Social-day cap -----------------------------------------------------------

Given("a season is simulated", function (this: BbWorld) {
  this.scheduleDays = simulateSeasonSchedule(new SeededRandom(7), WEEKS);
});

// regex: the step text contains parentheses.
Then(
  /^no week \(one HOH reign\) contains more than one social day \(a day with no ceremony beat\)$/,
  function (this: BbWorld) {
    for (const week of weeksOf(this.scheduleDays!)) {
      const social = week.filter((d) => d.isSocial).length;
      assert.ok(social <= 1, `a week had ${social} social days`);
    }
  },
);

Then("many weeks contain none", function (this: BbWorld) {
  const weeks = weeksOf(this.scheduleDays!);
  const withSocial = weeks.filter((w) => w.some((d) => d.isSocial)).length;
  assert.ok(withSocial <= weeks.length / 2, `${withSocial}/${weeks.length} weeks had a social day — should be a minority`);
});

Then("any social day still carries a significant house event", function (this: BbWorld) {
  for (const d of this.scheduleDays!.filter((x) => x.isSocial)) {
    assert.ok(d.significantHouseEvent, "a social day must still carry a significant house event");
  }
});
