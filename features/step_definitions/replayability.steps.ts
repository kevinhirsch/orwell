import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { PLAYER } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import {
  startNewGame, generateHouse, hashSeed, isPlausibleHouseguest, isPlausibleArchetype,
  dispositionOf, ENSEMBLE, CAST_SIZE, NPC_COUNT,
} from "../../src/engine/characterFactory";

// Legacy sample-save names that must NEVER be generated (BB_GameBible §3).
const FORBIDDEN_SAMPLE = ["ryne", "marcus", "felix"];

function newHouse(world: BbWorld): void {
  world.house = startNewGame({ seed: 1001, playerName: "AuthoredPlayer" });
}

When("a new game is started", function (this: BbWorld) {
  newHouse(this);
});

When("a new house is generated", function (this: BbWorld) {
  newHouse(this);
});

Given("a house generated with seed {string}", function (this: BbWorld, seed: string) {
  this.housesBySeed ??= {};
  this.housesBySeed[seed] = generateHouse(new SeededRandom(hashSeed(seed))).npcs;
});

// --- New game / new house -----------------------------------------------------

Then("a player character is produced via character creation", function (this: BbWorld) {
  assert.ok(this.house!.player, "a player should be produced");
  assert.equal(this.house!.player.authored, "oobe");
  assert.equal(this.house!.player.id, PLAYER);
});

Then(
  "the house is populated with newly generated, randomly-named houseguests",
  function (this: BbWorld) {
    assert.equal(this.house!.npcs.length, NPC_COUNT);
    assert.ok(this.house!.npcs.every((n) => n.authored === "generated"));
    assert.ok(this.house!.npcs.every((n) => n.name.length > 0));
  },
);

Then("no identity carries over from any previous game", function (this: BbWorld) {
  const previous = generateHouse(new SeededRandom(hashSeed("a-previous-game"))).npcs;
  const current = new Set(this.house!.npcs.map((n) => n.name));
  assert.ok(previous.every((p) => !current.has(p.name)), "no NPC identity should carry over");
});

// --- Cast composition ---------------------------------------------------------

Then("the house contains sixteen houseguests", function (this: BbWorld) {
  assert.equal(1 + this.house!.npcs.length, CAST_SIZE);
});

Then("exactly one is the player", function (this: BbWorld) {
  assert.ok(this.house!.player.id === PLAYER);
  assert.ok(this.house!.npcs.every((n) => n.id !== PLAYER));
});

Then("the other fifteen are NPCs", function (this: BbWorld) {
  assert.equal(this.house!.npcs.length, NPC_COUNT);
  assert.ok(this.house!.npcs.every((n) => n.authored === "generated"));
});

Then("the player's profile originates from OOBE authoring", function (this: BbWorld) {
  assert.equal(this.house!.player.authored, "oobe");
});

Then("every NPC profile is generated", function (this: BbWorld) {
  assert.ok(this.house!.npcs.every((n) => n.authored === "generated"));
});

// --- Plausibility & ensemble --------------------------------------------------

Then("each NPC profile is internally consistent", function (this: BbWorld) {
  assert.ok(this.house!.npcs.every(isPlausibleHouseguest), "every NPC must be internally consistent");
});

Then("each falls within plausible reality-TV contestant archetypes", function (this: BbWorld) {
  assert.ok(this.house!.npcs.every((n) => isPlausibleArchetype(n.character.archetype)));
});

Then(
  "the cast spans a spread of distinct archetypes and strategy styles",
  function (this: BbWorld) {
    const archetypes = new Set(this.house!.npcs.map((n) => n.character.archetype));
    const styles = new Set(this.house!.npcs.map((n) => n.character.strategyStyle));
    assert.ok(archetypes.size >= ENSEMBLE.MIN_DISTINCT_ARCHETYPES, `archetype spread ${archetypes.size}`);
    assert.ok(styles.size >= ENSEMBLE.MIN_DISTINCT_STYLES, `style spread ${styles.size}`);
  },
);

Then(
  "no single archetype dominates the house beyond the configured balance",
  function (this: BbWorld) {
    const counts = new Map<string, number>();
    for (const n of this.house!.npcs) counts.set(n.character.archetype, (counts.get(n.character.archetype) ?? 0) + 1);
    const max = Math.max(...counts.values());
    assert.ok(max <= ENSEMBLE.MAX_PER_ARCHETYPE, `max archetype count ${max}`);
  },
);

Then("the mix includes personalities likely to clash and to bond", function (this: BbWorld) {
  const dispositions = new Set(this.house!.npcs.map((n) => dispositionOf(n.character.archetype)));
  assert.ok(dispositions.has("clash"), "expected at least one clash-prone personality");
  assert.ok(dispositions.has("bond"), "expected at least one bond-prone personality");
});

// --- Naming -------------------------------------------------------------------

Then("every houseguest display name is unique within the house", function (this: BbWorld) {
  const names = [this.house!.player.name, ...this.house!.npcs.map((n) => n.name)];
  assert.equal(new Set(names).size, names.length, "names must be unique within the house");
});

Then("no name is drawn from any hard-coded or sample-save list", function (this: BbWorld) {
  for (const n of this.house!.npcs) {
    const first = n.name.split(" ")[0]!.toLowerCase();
    assert.ok(!FORBIDDEN_SAMPLE.includes(first), `name "${n.name}" must not come from the sample save`);
    assert.match(n.name, /^[A-Z][a-z]+ [A-Z][a-z]+$/, "names must be procedurally synthesized");
  }
});

// --- No carryover across seeds ------------------------------------------------

Then("the two houses share no houseguest identities", function (this: BbWorld) {
  const a = new Set(this.housesBySeed!["A"]!.map((n) => n.name));
  assert.ok(this.housesBySeed!["B"]!.every((n) => !a.has(n.name)), "houses must share no identities");
});
