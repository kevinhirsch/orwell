import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { buildSandbox } from "../../tests/support/sandbox";
import type { PreSeedCastView } from "../../src/ports/GameSession";

// Feature 0065 — cast pre-warm. HARD rule: roles only, no names. The warmed roster is engine ids +
// observable PUBLIC facets; the authored HIDDEN layer (secrets/goals/weakness/Day-1 read) never crosses.

const PW_HIDDEN_SENTINEL = "SENTINEL-0065-bdd-hidden";

function seedOf(label: string): number {
  let seed = 0;
  for (let i = 0; i < label.length; i++) seed = (Math.imul(seed, 31) + label.charCodeAt(i)) >>> 0;
  return seed;
}

// --- Scenario: the write-back reaches the engine over the player channel -------------------------

Given("a player-channel server with no game yet", function (this: BbWorld) {
  const sb = buildSandbox(1);
  const session = new GameSessionAdapter();
  const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
  this.pwServer = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
});

When("the cast is pre-warmed over the channel", async function (this: BbWorld) {
  this.pwWarm = (await this.pwServer!.callTool("preSeedCast", { seed: 5 })) as PreSeedCastView;
});

Then("the pre-warm returns a Vault-free roster with portrait prompts", function (this: BbWorld) {
  const warm = this.pwWarm!;
  assert.equal(warm.warmed, true, "the cast did not warm");
  assert.ok(warm.house.length > 0, "the warmed roster is empty");
  assert.ok(warm.portraitPrompts.length > 0, "no portrait prompts were returned");
  const blob = JSON.stringify(warm);
  for (const banned of ["secret", "trueGoal", "weakness", "dayOnePerception", "\"trust\":", "\"threat\":"]) {
    assert.ok(!blob.includes(banned), `the warmed roster leaked a hidden key: ${banned}`);
  }
  this.pwId = warm.house[0]!.id;
});

When("an authored biography is written back over the channel for a warmed houseguest", async function (this: BbWorld) {
  const res = (await this.pwServer!.callTool("recordCastProfile", {
    houseguestId: this.pwId, biography: "A real two-sentence backstory. It has presentable parts.",
  })) as { accepted: boolean };
  this.pwWriteAccepted = res.accepted;
});

Then("the write-back is accepted over the channel", function (this: BbWorld) {
  assert.equal(this.pwWriteAccepted, true, "the authoring write-back was rejected at the channel");
});

// --- Scenario: the warmed cast is deep, Vault-free, player-independent ---------------------------

Given("a pre-warmed cast for seed {string}", function (this: BbWorld, label: string) {
  this.pwSession = new GameSessionAdapter();
  this.pwWarm = this.pwSession.preSeedCast({ seed: seedOf(label) });
  this.pwId = this.pwWarm.house[0]!.id;
});

Then("every warmed houseguest carries a multi-sentence biography", function (this: BbWorld) {
  for (const h of this.pwWarm!.house) {
    assert.ok(typeof h.biography === "string" && h.biography.length > 0, "a warmed houseguest has no biography");
    assert.ok((h.biography!.match(/[.!?]/g) ?? []).length >= 2, "a warmed biography is not multi-sentence");
  }
});

Then("the warmed roster carries no secret, true goal, weakness, or perception", function (this: BbWorld) {
  const blob = JSON.stringify(this.pwWarm!.house);
  for (const banned of ["secret", "trueGoal", "weakness", "dayOnePerception"]) {
    assert.ok(!blob.includes(banned), `a hidden key reached the warmed roster: ${banned}`);
  }
});

Then("a second pre-warm of the same seed produces the same warmed cast", function (this: BbWorld) {
  const again = new GameSessionAdapter().preSeedCast({ seed: this.pwWarm!.seed });
  assert.deepEqual(again.house.map((h) => h.name), this.pwWarm!.house.map((h) => h.name), "same seed warmed a different roster");
  assert.deepEqual(again.house.map((h) => h.biography), this.pwWarm!.house.map((h) => h.biography), "same seed warmed different biographies");
});

// --- Scenario: createCharacter adopts the warmed + authored cast ---------------------------------

Given("a houseguest biography is authored before the season starts", function (this: BbWorld) {
  this.pwAuthored = "An authored life outside the house. With presentable, real detail.";
  const res = this.pwSession!.recordCastProfile({
    houseguestId: this.pwId!,
    biography: this.pwAuthored,
    secrets: [`${PW_HIDDEN_SENTINEL}-secret`],
    weakness: `${PW_HIDDEN_SENTINEL}-weakness`,
  });
  assert.equal(res.accepted, true, "the pre-game authoring write-back was rejected");
});

When("the season is finalized with the warmed seed", function (this: BbWorld) {
  this.pwView = this.pwSession!.createCharacter({ playerName: "The Player", seed: this.pwWarm!.seed });
});

Then("the authored biography is on the live house", function (this: BbWorld) {
  const card = this.pwView!.house.find((h) => h.id === this.pwId);
  assert.ok(card, "the authored houseguest is not on the live house");
  assert.equal(card!.biography, this.pwAuthored, "the authored biography was lost on adoption");
});

Then("the live game state never leaks the authored hidden content", function (this: BbWorld) {
  const blob = JSON.stringify(this.pwView)
    + JSON.stringify(this.pwSession!.getGameState())
    + JSON.stringify(this.pwSession!.getMomentPrompt({}));
  assert.ok(!blob.includes(PW_HIDDEN_SENTINEL), "the adopted game leaked the authored hidden content");
});

// --- Scenario: a half-warmed authored cast is durable -------------------------------------------

When("the warmed cast is snapshotted and restored", function (this: BbWorld) {
  const core = this.pwSession!.snapshot();
  const restored = new GameSessionAdapter();
  restored.restore(core);
  this.pwSession = restored;
});
