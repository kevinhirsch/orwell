import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { newGameState, advanceGame } from "../../src/engine/gameProgression";
import { InMemorySaveStore } from "../../src/adapters/inmemory/InMemorySaveStore";
import {
  serialize, deserialize, isSuperset, counts, countsNonDecreasing,
} from "../../src/domain/saveState";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

function startGame(world: BbWorld, seed: number, advances: number): void {
  world.rng = new SeededRandom(seed);
  world.gameState = newGameState(world.rng);
  world.store = new InMemorySaveStore();
  for (let k = 0; k < advances; k++) advanceGame(world.gameState, world.rng, `t${k}`);
}

// --- Lossless round-trip ------------------------------------------------------

Given("a game with accumulated behavioral detail", function (this: BbWorld) {
  startGame(this, 1, 6);
});

When("the game is saved and immediately reloaded", function (this: BbWorld) {
  this.loaded = deserialize(serialize(this.gameState!));
});

Then("the reloaded state equals the saved state with no field dropped", function (this: BbWorld) {
  assert.deepEqual(this.loaded, this.gameState);
});

// --- Cross-version non-degradation --------------------------------------------

Given("a game saved at one version", function (this: BbWorld) {
  startGame(this, 2, 3);
  this.saveRef = this.store!.save(this.gameState!);
  this.early = this.store!.load(this.saveRef);
});

When("the game is reloaded and saved again at the next version", function (this: BbWorld) {
  advanceGame(this.gameState!, this.rng!, "next-version");
  this.saveRef2 = this.store!.save(this.gameState!);
  this.late = this.store!.load(this.saveRef2);
});

Then("every datum present at the earlier version is still present", function (this: BbWorld) {
  assert.ok(isSuperset(this.late!, this.early!), "later version must be a superset of the earlier");
});

Then("no previously-persisted detail is lost", function (this: BbWorld) {
  assert.ok(countsNonDecreasing(counts(this.late!), counts(this.early!)), "no counts may decrease");
});

// --- Accumulation -------------------------------------------------------------

Given("two saves taken at two points in the same game", function (this: BbWorld) {
  startGame(this, 3, 2);
  this.early = this.store!.load(this.store!.save(this.gameState!));
  for (let k = 0; k < 4; k++) advanceGame(this.gameState!, this.rng!, `more-${k}`);
  this.late = this.store!.load(this.store!.save(this.gameState!));
});

When("the later save is compared to the earlier", function (this: BbWorld) {
  assert.ok(this.early && this.late);
});

Then("the later save is a superset of the earlier", function (this: BbWorld) {
  assert.ok(isSuperset(this.late!, this.early!));
});

Then(
  "the counts of events, knowledge facts, and relationship edges are non-decreasing",
  function (this: BbWorld) {
    const e = counts(this.early!);
    const l = counts(this.late!);
    assert.ok(l.events >= e.events);
    assert.ok(l.knowledge >= e.knowledge);
    assert.ok(l.relationships >= e.relationships);
  },
);

// --- Active deepening of the soul ---------------------------------------------

Given("a long seeded game saved early and again late", function (this: BbWorld) {
  startGame(this, 4, 2);
  this.early = this.store!.load(this.store!.save(this.gameState!));
  for (let k = 0; k < 25; k++) advanceGame(this.gameState!, this.rng!, `late-${k}`);
  this.late = this.store!.load(this.store!.save(this.gameState!));
});

When("the late soul is compared to the early soul", function (this: BbWorld) {
  assert.ok(this.early && this.late);
});

Then(
  "the soul's relationship beliefs, emotional history, and memory have grown materially",
  function (this: BbWorld) {
    const e = counts(this.early!);
    const l = counts(this.late!);
    assert.ok(l.soulMemory > e.soulMemory + 50, "memory grew materially");
    assert.ok(l.soulHistory > e.soulHistory + 50, "emotional history grew materially");
    assert.ok(l.soulBeliefs >= e.soulBeliefs, "relationship beliefs did not regress");
  },
);

Then("the static character baseline is unchanged", function (this: BbWorld) {
  assert.deepEqual(this.late!.characters, this.early!.characters);
});

// --- Co-versioning ------------------------------------------------------------

Given("a save is taken", function (this: BbWorld) {
  startGame(this, 5, 3);
  this.saveRef = this.store!.save(this.gameState!);
});

When("the Vault store version increments", function (this: BbWorld) {
  advanceGame(this.gameState!, this.rng!, "again");
  this.saveRef2 = this.store!.save(this.gameState!);
});

Then("the Journal store version increments in the same save", function (this: BbWorld) {
  assert.equal(this.saveRef!.vaultVersion, this.saveRef!.journalVersion);
  assert.equal(this.saveRef2!.vaultVersion, this.saveRef2!.journalVersion);
  assert.equal(this.saveRef2!.vaultVersion, this.saveRef!.vaultVersion + 1);
  assert.equal(this.saveRef2!.journalVersion, this.saveRef!.journalVersion + 1);
});

// --- Long seeded game: every save supersets the prior -------------------------

Given("the game is simulated and saved repeatedly with seed {string}", function (this: BbWorld, seed: string) {
  this.rng = new SeededRandom(Number(seed));
  this.gameState = newGameState(this.rng);
  this.store = new InMemorySaveStore();
  this.snapshots = [];
  for (let k = 0; k < 6; k++) {
    advanceGame(this.gameState, this.rng, `s${k}`);
    this.snapshots.push(this.store.load(this.store.save(this.gameState)));
  }
});

Then("each save is a superset of the one before it", function (this: BbWorld) {
  for (let i = 1; i < this.snapshots!.length; i++) {
    assert.ok(isSuperset(this.snapshots![i]!, this.snapshots![i - 1]!), `save ${i} ⊇ ${i - 1}`);
    assert.ok(countsNonDecreasing(counts(this.snapshots![i]!), counts(this.snapshots![i - 1]!)));
  }
});
