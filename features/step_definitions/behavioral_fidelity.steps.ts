import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { simulateSeason } from "../../src/engine/simulation";
import { richnessMetrics } from "../../src/engine/richness";
import { RICHNESS } from "../../src/engine/richnessConfig";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER } from "../../src/domain/ids";

function simulate(world: BbWorld, seed: number): void {
  world.season = simulateSeason({ rng: new SeededRandom(seed) });
  world.metrics = richnessMetrics(world.season);
}

// --- Background ---------------------------------------------------------------

Given("an active game simulated over many in-game days with a fixed seed", function (this: BbWorld) {
  simulate(this, 1);
});

When("the simulated stretch completes", function (this: BbWorld) {
  assert.ok(this.season && this.metrics, "the season should have been simulated");
});

// --- Rich social life ---------------------------------------------------------

Then(
  "alliances, gossip, scheming, and private conversations have occurred among NPCs",
  function (this: BbWorld) {
    const types = this.metrics!.types;
    for (const t of ["alliance", "gossip", "strategy"]) {
      assert.ok(types.includes(t), `expected interaction type "${t}" to occur`);
    }
    assert.ok(
      this.season!.events.query({ hidden: true }).length > 0,
      "expected private (off-screen) NPC conversations",
    );
  },
);

Then("most of them occurred off-screen relative to the player", function (this: BbWorld) {
  assert.ok(this.metrics!.offscreenShare > 0.5, `off-screen share ${this.metrics!.offscreenShare} should be a majority`);
});

// --- NPC-initiated, player-excluded scenes ------------------------------------

Then(
  "some scenes were initiated by NPCs with witness sets that exclude the player",
  function (this: BbWorld) {
    const hidden = this.season!.events.query({ hidden: true });
    assert.ok(hidden.length > 0, "expected off-screen scenes");
    assert.ok(hidden.every((e) => !e.witnessSet.includes(PLAYER)), "off-screen scenes exclude the player");
    assert.ok(hidden.some((e) => e.initiator.startsWith("npc:")), "scenes are NPC-initiated");
  },
);

// --- Alliance churn -----------------------------------------------------------

Then("at least one alliance formed", function (this: BbWorld) {
  assert.ok(this.metrics!.alliancesFormed >= 1, "expected at least one alliance to form");
});

Then("at least one alliance shifted or fractured", function (this: BbWorld) {
  assert.ok(this.metrics!.alliancesFractured >= 1, "expected at least one alliance to fracture");
});

Then("relationship edge strengths changed over time", function (this: BbWorld) {
  assert.ok(this.metrics!.edgeStrengthsChanged, "relationship edges should have moved");
});

// --- Surfacing rarity ---------------------------------------------------------

Then("hidden elements were revealed on only a small fraction of moments", function (this: BbWorld) {
  const rate = this.metrics!.surfacingRate;
  assert.ok(rate > 0, "some hidden element should surface over a long game");
  assert.ok(rate <= RICHNESS.MAX_SURFACING_RATE, `surfacing rate ${rate} should stay rare`);
});

Then(
  "no single moment revealed more than the allowed maximum of hidden elements",
  function (this: BbWorld) {
    assert.ok(this.metrics!.maxRevealsPerMoment <= RICHNESS.MAX_REVEALS_PER_MOMENT, "no dumping");
  },
);

// --- Thresholds across seeds --------------------------------------------------

Given("the game is simulated with seed {string}", function (this: BbWorld, seed: string) {
  simulate(this, Number(seed));
});

// regex (not a Cucumber Expression) because the step text contains parentheses.
Then(
  /^most NPC interactions occurred off-screen \(share ≥ the configured majority minimum\)$/,
  function (this: BbWorld) {
    assert.ok(
      this.metrics!.offscreenShare >= RICHNESS.MIN_OFFSCREEN_SHARE,
      `off-screen share ${this.metrics!.offscreenShare} < ${RICHNESS.MIN_OFFSCREEN_SHARE}`,
    );
  },
);

Then("the diversity of NPC interaction types meets the configured minimum", function (this: BbWorld) {
  assert.ok(
    this.metrics!.typeDiversity >= RICHNESS.MIN_TYPE_DIVERSITY,
    `type diversity ${this.metrics!.typeDiversity} < ${RICHNESS.MIN_TYPE_DIVERSITY}`,
  );
});

Then("the hidden-element surfacing rate stays within the configured bounds", function (this: BbWorld) {
  const rate = this.metrics!.surfacingRate;
  assert.ok(rate > 0 && rate <= RICHNESS.MAX_SURFACING_RATE, `surfacing rate ${rate} out of bounds`);
});
