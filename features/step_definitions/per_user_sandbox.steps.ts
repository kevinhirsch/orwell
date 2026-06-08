import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { UserSandbox } from "../../src/composition/registry";
import type { PlayerSurfaceType } from "../../src/surfaces/player/PlayerSurface";

const A = "user:A";
const B = "user:B";
const SURFACES: PlayerSurfaceType[] = [
  "scene narration", "NPC dialogue", "system message", "player-visible log", "end-of-session summary",
];

function playerOutputs(sb: UserSandbox): string {
  return [
    ...SURFACES.map((s) => sb.player.produce(s)),
    sb.player.socialRead(),
    JSON.stringify(sb.session.getGameState()),
    JSON.stringify(sb.session.gameStatus()),
  ].join("\n");
}

function houseNames(sb: UserSandbox): string[] {
  return sb.session.getGameState().house.map((h) => h.name);
}

// --- Background ---------------------------------------------------------------

Given("two authenticated users, user A and user B", function (this: BbWorld) {
  this.registry = new GameSessionRegistry();
});

// --- Each user gets their own isolated game -----------------------------------

When("user A starts a game", function (this: BbWorld) {
  this.registry!.sandboxFor(A).session.createCharacter({ playerName: "Player A", seed: 1 });
});

When("user B starts a game", function (this: BbWorld) {
  this.registry!.sandboxFor(B).session.createCharacter({ playerName: "Player B", seed: 2 });
});

Then("user A and user B have different houses", function (this: BbWorld) {
  const a = new Set(houseNames(this.registry!.sandboxFor(A)));
  const b = houseNames(this.registry!.sandboxFor(B));
  assert.ok(b.length > 0 && b.some((n) => !a.has(n)), "the two houses differ");
});

Then("neither user's game is affected by the other", function (this: BbWorld) {
  // Distinct object graphs: A's player card is A's, B's is B's.
  assert.equal(this.registry!.sandboxFor(A).session.getGameState().player!.name, "Player A");
  assert.equal(this.registry!.sandboxFor(B).session.getGameState().player!.name, "Player B");
});

// --- Cross-user isolation -----------------------------------------------------

Given("user A has a game seeded with unique sentinel values", function (this: BbWorld) {
  const a = this.registry!.sandboxFor(A);
  a.session.createCharacter({ playerName: "PlayerA-SENTINEL-AAA", seed: 11 });
  // Seed A's hidden layer + event log with unmistakable sentinels.
  a.engine.vault.writeHidden({ id: "vault:A", kind: "hidden-thread", content: "A-SECRET-SENTINEL-AAA" });
  a.engine.events.record({
    id: "evt:A", ts: 1, type: "conversation", initiator: "player",
    witnessSet: ["player"], hidden: false, content: "A-VISIBLE-SENTINEL-AAA",
  });
});

When("any tool is called on behalf of user B", function (this: BbWorld) {
  this.registry!.sandboxFor(B).session.createCharacter({ playerName: "Player B", seed: 22 });
  this.lastOutput = playerOutputs(this.registry!.sandboxFor(B));
});

Then("no sentinel from user A's game appears in user B's results", function (this: BbWorld) {
  for (const s of ["A-SECRET-SENTINEL-AAA", "A-VISIBLE-SENTINEL-AAA", "PlayerA-SENTINEL-AAA"]) {
    assert.ok(!this.lastOutput.includes(s), `user A's data leaked to user B: ${s}`);
  }
});

Then("the reverse also holds", function (this: BbWorld) {
  // B's data must likewise be unreachable from A's surfaces.
  const aOut = playerOutputs(this.registry!.sandboxFor(A));
  assert.ok(!aOut.includes("Player B"), "user B's data leaked to user A");
});

// --- One active game per user -------------------------------------------------

Given("user A has an active game", function (this: BbWorld) {
  this.registry!.sandboxFor(A).session.createCharacter({ playerName: "Player A", seed: 1 });
  this.userASnapshot = JSON.stringify(houseNames(this.registry!.sandboxFor(A)));
});

Given("user B has an active game", function (this: BbWorld) {
  this.registry!.sandboxFor(B).session.createCharacter({ playerName: "Player B", seed: 2 });
});

When("user A starts a new game", function (this: BbWorld) {
  // A new game replaces ONLY user A's sandbox.
  this.registry!.resetUser(A).session.createCharacter({ playerName: "Player A", seed: 99 });
});

Then("user A's previous game is replaced", function (this: BbWorld) {
  assert.notEqual(JSON.stringify(houseNames(this.registry!.sandboxFor(A))), this.userASnapshot);
});

Then("user B's game is unchanged", function (this: BbWorld) {
  assert.equal(this.registry!.sandboxFor(B).session.getGameState().player!.name, "Player B");
});

// --- Concurrency --------------------------------------------------------------

Given("many users each start a game at the same time", function (this: BbWorld) {
  for (let i = 0; i < 8; i++) this.registry!.sandboxFor(`user:${i}`).session.createCharacter({ playerName: `Player ${i}`, seed: i + 1 });
});

Then("each user has their own distinct game", function (this: BbWorld) {
  assert.equal(this.registry!.userCount(), 8);
  const names = new Set<string>();
  for (let i = 0; i < 8; i++) names.add(this.registry!.sandboxFor(`user:${i}`).session.getGameState().player!.name);
  assert.equal(names.size, 8);
});

Then("no user's actions change another user's game", function (this: BbWorld) {
  // Acting on user 0 leaves user 1 untouched.
  this.registry!.sandboxFor("user:0").session.runCompetition({ type: "endurance" });
  assert.equal(this.registry!.sandboxFor("user:1").session.getGameState().player!.name, "Player 1");
});

// --- Resume -------------------------------------------------------------------

Given("user A has an in-progress game", function (this: BbWorld) {
  this.registry!.sandboxFor(A).session.createCharacter({ playerName: "Player A", seed: 7 });
  this.userASnapshot = JSON.stringify(this.registry!.sandboxFor(A).session.getGameState());
});

When("user A returns later", function (this: BbWorld) {
  // A later request for the same user resolves to the SAME ongoing sandbox.
  this.lastOutput = JSON.stringify(this.registry!.sandboxFor(A).session.getGameState());
});

Then("user A is resumed into the same ongoing game", function (this: BbWorld) {
  assert.equal(this.lastOutput, this.userASnapshot);
});

// --- Vault Wall inside each sandbox -------------------------------------------

Given("user A has a game with a fully populated Producer's Vault", function (this: BbWorld) {
  const a = this.registry!.sandboxFor(A);
  a.session.createCharacter({ playerName: "Player A", seed: 3 });
  for (let i = 1; i <= 4; i++) {
    a.engine.vault.writeHidden({ id: `vault:A:${i}`, kind: "hidden-attribute", content: `A-VAULT-SENTINEL-${i}` });
  }
});

When("any player-facing surface is produced for user A", function (this: BbWorld) {
  this.lastOutput = playerOutputs(this.registry!.sandboxFor(A));
});

Then("no Vault sentinel value from user A's game appears", function (this: BbWorld) {
  for (let i = 1; i <= 4; i++) assert.ok(!this.lastOutput.includes(`A-VAULT-SENTINEL-${i}`), "Vault sentinel leaked");
});

// --- God Mode does not browse across users ------------------------------------

Given("an administrator inspecting one user's sandbox", function (this: BbWorld) {
  this.registry!.sandboxFor(A).session.createCharacter({ playerName: "Player A", seed: 1 });
  this.registry!.sandboxFor(B).session.createCharacter({ playerName: "Player B", seed: 2 });
});

Then("no other user's game state is reachable", function (this: BbWorld) {
  // The admin surface is per-sandbox; A's admin sees only A's non-Vault state, and there is no
  // API on a sandbox by which another user's sandbox can be reached.
  const aAdmin = JSON.stringify(this.registry!.sandboxFor(A).admin.inspect());
  assert.ok(!aAdmin.includes("Player B"));
  const a = this.registry!.sandboxFor(A) as unknown as Record<string, unknown>;
  assert.ok(!("sandboxFor" in a) && !("sandboxes" in a), "a sandbox exposes no handle to other users");
});
