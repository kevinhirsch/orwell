import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BbWorld } from "../support/world";
import { GameSessionRegistry } from "../../src/composition/registry";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { toGameState } from "../../src/engine/sessionSnapshot";
import { counts, isSuperset, countsNonDecreasing } from "../../src/domain/saveState";

// "user A"/"user B" are account roles (0021); a "restart" = a NEW registry over the SAME data dir.
const A = "user-a";
const B = "user-b";

const newDir = (): string => mkdtempSync(join(tmpdir(), "orwell-0030-"));

// --- A started game survives a restart ----------------------------------------

Given("a user has created their houseguest and a game is in progress", function (this: BbWorld) {
  this.saveDir = newDir();
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  this.viewBefore = this.registry.sandboxFor(A).session.createCharacter({ playerName: "Player One", seed: 7 });
});

When("the engine restarts and that user's sandbox is resumed", function (this: BbWorld) {
  this.registry2 = new GameSessionRegistry(new FileSaveStore(this.saveDir!));
  this.viewAfter = this.registry2.sandboxFor(A).session.getGameState();
});

Then("the recalled game reports that it has started", function (this: BbWorld) {
  assert.equal(this.viewAfter!.started, true);
});

Then("it carries the same week, phase, and house roster as before the restart", function (this: BbWorld) {
  assert.equal(this.viewAfter!.week, this.viewBefore!.week);
  assert.equal(this.viewAfter!.phase, this.viewBefore!.phase);
  assert.equal(this.viewAfter!.player?.name, this.viewBefore!.player?.name);
  assert.deepEqual(this.viewAfter!.house.map((h) => h.name), this.viewBefore!.house.map((h) => h.name));
});

Then("a fresh onboarding state check for that user would not show the welcome overlay", function (this: BbWorld) {
  // The overlay shows exactly when the engine reports no started game; the resumed game is started.
  assert.equal(this.viewAfter!.started, true);
});

// --- A user with no save still onboards ---------------------------------------

Given("one user has a saved game and another user has none", function (this: BbWorld) {
  this.saveDir = newDir();
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  this.registry.sandboxFor(A).session.createCharacter({ playerName: "Saved One", seed: 3 });
  // user B never creates a game.
});

When("the engine restarts", function (this: BbWorld) {
  this.registry2 = new GameSessionRegistry(new FileSaveStore(this.saveDir!));
});

Then("resuming the first user reports a started game", function (this: BbWorld) {
  assert.equal(this.registry2!.sandboxFor(A).session.getGameState().started, true);
});

Then("resuming the second user reports no started game", function (this: BbWorld) {
  assert.equal(this.registry2!.sandboxFor(B).session.getGameState().started, false);
});

// --- Per-user isolation across a restart --------------------------------------

Given("two users each have their own in-progress game", function (this: BbWorld) {
  this.saveDir = newDir();
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  this.registry.sandboxFor(A).session.createCharacter({ playerName: "Alpha", seed: 11 });
  this.registry.sandboxFor(B).session.createCharacter({ playerName: "Bravo", seed: 22 });
});

When("the engine restarts and both sandboxes are resumed", function (this: BbWorld) {
  this.registry2 = new GameSessionRegistry(new FileSaveStore(this.saveDir!));
  this.viewAfter = this.registry2.sandboxFor(A).session.getGameState();
  this.viewAfterB = this.registry2.sandboxFor(B).session.getGameState();
});

Then("each user's recalled game is their own", function (this: BbWorld) {
  assert.equal(this.viewAfter!.player?.name, "Alpha");
  assert.equal(this.viewAfterB!.player?.name, "Bravo");
});

Then("no call on behalf of one user returns the other user's game", function (this: BbWorld) {
  assert.notEqual(this.viewAfter!.player?.name, this.viewAfterB!.player?.name);
  assert.notDeepEqual(
    this.viewAfter!.house.map((h) => h.name),
    this.viewAfterB!.house.map((h) => h.name),
  );
});

// --- Detail does not degrade across a restart ---------------------------------

Given("a game with recorded events, relationship beliefs, and deepened souls", function (this: BbWorld) {
  this.saveDir = newDir();
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  const sb = this.registry.sandboxFor(A);
  sb.session.createCharacter({ playerName: "Keeper", seed: 5 });
  // Real mutations that fold into events + the hidden relationship layer (0023). The command seam
  // is player-witnessed by rule (E21); off-screen scenes are the engine's to mint.
  sb.commands.recordInteraction({ initiator: "npc:1", witnessSet: ["npc:1", "player"], content: "a quiet warning", kind: "betrayal" });
  sb.commands.recordInteraction({ initiator: "player", witnessSet: ["player", "npc:2"], content: "an alliance forms", kind: "alliance" });
});

When("the game is saved, the engine restarts, and the game is resumed", function (this: BbWorld) {
  this.savedSnap = new FileSaveStore(this.saveDir!).loadLatest(A)!;
  this.registry2 = new GameSessionRegistry(new FileSaveStore(this.saveDir!));
  this.registry2.sandboxFor(A); // resume (re-records events + reloads beliefs)
  this.registry2.saveUser(A); // re-export the resumed state
  this.resumedSnap = new FileSaveStore(this.saveDir!).loadLatest(A)!;
});

// NOTE: the literal "(" is escaped — in a Cucumber Expression an unescaped "(...)" is an optional group.
Then("every previously persisted detail is still present \\(a superset)", function (this: BbWorld) {
  assert.ok(isSuperset(toGameState(this.resumedSnap!), toGameState(this.savedSnap!)));
});

Then("every detail count is non-decreasing", function (this: BbWorld) {
  assert.ok(countsNonDecreasing(counts(toGameState(this.resumedSnap!)), counts(toGameState(this.savedSnap!))));
  assert.ok(counts(toGameState(this.resumedSnap!)).events >= 2);
});

Then("the static character baseline is byte-for-byte unchanged", function (this: BbWorld) {
  assert.equal(
    JSON.stringify(this.resumedSnap!.house?.npcs.map((n) => n.character)),
    JSON.stringify(this.savedSnap!.house?.npcs.map((n) => n.character)),
  );
});

// --- The Vault Wall holds on a resumed game -----------------------------------

Given("a saved game whose Vault holds off-screen NPC scheming and hidden attributes", function (this: BbWorld) {
  this.saveDir = newDir();
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  const sb = this.registry.sandboxFor(A);
  sb.session.createCharacter({ playerName: "Watched", seed: 9 });
  this.durableSentinel = "SENTINEL-0030-OFFSCREEN";
  // Off-screen scheming the player did NOT witness — hidden, persisted, must STAY hidden on reload.
  // Minted ENGINE-side, as off-screen life is in production: the player-channel command seam refuses
  // witness sets that exclude the player (E21), so the hidden layer is written directly here.
  sb.engine.events.record({
    id: "evt:0030:scheme", ts: 9_000_030, type: "conversation",
    initiator: "npc:1", witnessSet: ["npc:1", "npc:2"], hidden: true,
    content: `secret scheme ${this.durableSentinel}`,
  });
  // A hidden attribute in the Vault (engine-only; never persisted to the player save, never surfaced).
  sb.engine.vault.writeHidden({ id: "vault:0030", kind: "hidden-attribute", content: `hidden trait ${this.durableSentinel}-VAULT` });
  this.registry.saveUser(A); // the direct engine-side write persists like any live mutation
});

When("the engine restarts and the player surface is queried over the resumed game", function (this: BbWorld) {
  this.registry2 = new GameSessionRegistry(new FileSaveStore(this.saveDir!));
  const p = this.registry2.sandboxFor(A).player;
  this.lastOutput = [
    p.produce("player-visible log"),
    p.produce("scene narration"),
    p.produce("NPC dialogue"),
    JSON.stringify(p.assembleNarrationContext("scene")),
    JSON.stringify(p.getVisibleState()),
  ].join("\n---\n");
});

Then("the player surface returns no Vault data", function (this: BbWorld) {
  assert.ok(
    !this.lastOutput.includes(this.durableSentinel!),
    "no hidden/off-screen content may surface on the resumed game",
  );
});
