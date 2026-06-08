import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import {
  momentForPhase, momentFragment, buildSystemPrompt, renderGameContext,
  BASE_GAME_MASTER_PROMPT, MOMENT_PROMPTS,
} from "../../src/engine/momentPrompts";
import type { GameStateView } from "../../src/ports/GameSession";
import { PLAYER_AGENT_LEVERS } from "../../src/surfaces/tools/registry";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER, npc } from "../../src/domain/ids";
import { assertNoSentinels, assertNoneAppear } from "../../tests/support/assertions";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Background "a running game sandbox with a fully populated Producer's Vault" → mcp_boundary.steps.

function startedView(phase: string): GameStateView {
  return {
    started: true, week: 2, phase, moment: momentForPhase(phase),
    player: { id: PLAYER, name: "Player One", archetype: "mastermind", strategyStyle: "strategic" },
    house: [
      { id: npc(1), name: "Houseguest One", status: "active" },
      { id: npc(2), name: "Houseguest Two", status: "active" },
    ],
  };
}

const ALL_MOMENTS = Object.keys(MOMENT_PROMPTS);

// --- Moment derived from phase ------------------------------------------------

Given("the game is in a given phase", function (this: BbWorld) {
  this.gsView = startedView("nominations");
});

When("the current moment is requested", function (this: BbWorld) {
  this.gsMoment = momentForPhase(this.gsView!.phase);
});

Then("the moment corresponds to that phase", function (this: BbWorld) {
  assert.equal(this.gsMoment, momentForPhase(this.gsView!.phase));
  assert.equal(this.gsMoment, "nominations");
});

Then("the same game state always yields the same moment", function (this: BbWorld) {
  assert.equal(momentForPhase(this.gsView!.phase), momentForPhase(this.gsView!.phase));
});

// --- Narrator cannot advance the game -----------------------------------------

Given("the game is at the nomination phase", function (this: BbWorld) {
  this.gsView = startedView("nominations");
});

When("the narrator produces narration for the moment", function (this: BbWorld) {
  this.lastOutput = buildSystemPrompt(momentForPhase(this.gsView!.phase), this.gsView!);
});

Then("the phase is still the nomination phase", function (this: BbWorld) {
  assert.equal(this.gsView!.phase, "nominations"); // narration is a pure read; it mutates nothing
});

Then("the moment is unchanged", function (this: BbWorld) {
  assert.equal(momentForPhase(this.gsView!.phase), "nominations");
});

// --- Persona framing ----------------------------------------------------------

When("the system prompt for any moment is built", function (this: BbWorld) {
  this.lastOutput = buildSystemPrompt("nominations", startedView("nominations"));
});

Then("it frames the model as the host and the voice of the house", function (this: BbWorld) {
  assert.match(this.lastOutput, /host/i);
  assert.match(this.lastOutput, /voice of every houseguest/i);
});

Then("it forbids the model from breaking character as a generic assistant", function (this: BbWorld) {
  assert.match(this.lastOutput, /not a generic ai assistant/i);
});

// --- Lever manifest (0018 / B21): the base prompt names every game-driving lever ----

When("the base system prompt is built", function (this: BbWorld) {
  this.lastOutput = BASE_GAME_MASTER_PROMPT;
});

Then("it names every player-channel lever the agent can call", function (this: BbWorld) {
  const missing = PLAYER_AGENT_LEVERS.filter((name) => !this.lastOutput.includes(name));
  assert.deepEqual(missing, [], `levers missing from the manifest: ${missing.join(", ")}`);
});

Then("it states that the engine decides outcomes and the model only voices them", function (this: BbWorld) {
  assert.match(this.lastOutput, /engine\s+decides/i);
  assert.match(this.lastOutput, /never invent/i);
});

Then("no lever in the player tool registry is missing from it", function (this: BbWorld) {
  for (const name of PLAYER_AGENT_LEVERS) assert.ok(this.lastOutput.includes(name), `manifest names ${name}`);
});

When("the system prompt for a competition moment is built", function (this: BbWorld) {
  this.lastOutput = buildSystemPrompt("hoh-competition", startedView("hoh-competition"));
});

Then("it directs the model to resolve the competition through the engine", function (this: BbWorld) {
  assert.match(this.lastOutput, /runCompetition/);
});

Then("it forbids inventing the winner or revealing scores", function (this: BbWorld) {
  assert.match(this.lastOutput, /never choose the winner|no scores|only the winner/i);
});

// --- Sentinel-free under any Vault contents -----------------------------------

When("the system prompt is built for every moment", function (this: BbWorld) {
  const game = new GameSessionAdapter();
  game.createCharacter({ playerName: "Player One", seed: 1 });
  const view = game.getGameState(); // Vault-free projection
  this.lastOutput = ALL_MOMENTS.map((m) => buildSystemPrompt(m, view)).join("\n----\n");
});

Then("no hidden attribute appears in it", function (this: BbWorld) {
  assertNoneAppear(this.lastOutput, this.sandbox!.hiddenContents);
});

Then("no off-screen event appears in it", function (this: BbWorld) {
  assertNoneAppear(this.lastOutput, this.sandbox!.hiddenContents);
});

Then("no Vault sentinel value appears in it", function (this: BbWorld) {
  assertNoSentinels(this.lastOutput, this.sandbox!.sentinels);
});

// --- Woven context is Vault-free ----------------------------------------------

// Shared (0018 + 0031): a started game in a registry-backed sandbox + an orchestrator.
// `gsView` (the 0018 projection) is byte-identical to the bare-adapter path; the
// registry/orchestrator/clock are what 0031's advance scenarios drive.
Given("a started game", function (this: BbWorld) {
  this.saveDir = mkdtempSync(join(tmpdir(), "orwell-started-"));
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  this.fakeClock = new FakeClock();
  this.orchestrator = new Orchestrator(this.registry, this.fakeClock, { seed: 4 });
  const sb = this.registry.sandboxFor("user-a");
  sb.session.createCharacter({ playerName: "Player One", seed: 4 });
  this.orchestrator.touch("user-a");
  this.gsView = sb.session.getGameState();
});

When("the system prompt's game context is built", function (this: BbWorld) {
  this.lastOutput = renderGameContext(this.gsView!);
});

Then("it contains the player's own card, the phase, and the house roster by name", function (this: BbWorld) {
  assert.match(this.lastOutput, new RegExp(this.gsView!.player!.name));
  assert.ok(this.lastOutput.includes(this.gsView!.phase));
  for (const h of this.gsView!.house) assert.ok(this.lastOutput.includes(h.name), `roster name ${h.name}`);
});

Then("it contains no competition stats, souls, archetypes, or hidden attributes", function (this: BbWorld) {
  // Stats / souls / hidden internals never cross — the roster is name+status only.
  for (const banned of ["physical", "mental", "social", "soul", "volatility", "emotionalBaseline", "emotionalState"]) {
    assert.ok(!this.lastOutput.includes(banned), `leaked: ${banned}`);
  }
});

// --- Editing a fragment is isolated -------------------------------------------

Given("the managed per-moment prompt registry", function () {
  // MOMENT_PROMPTS is the single managed registry.
});

When("the fragment for one moment is changed", function (this: BbWorld) {
  const view = startedView("social");
  const original = MOMENT_PROMPTS["social"]!;
  const baseBefore = BASE_GAME_MASTER_PROMPT;
  const otherBefore = momentFragment("nominations");
  try {
    MOMENT_PROMPTS["social"] = "MOMENT — EDITED-FRAGMENT-XYZ";
    this.lastOutput = JSON.stringify({
      socialChanged: buildSystemPrompt("social", view).includes("EDITED-FRAGMENT-XYZ"),
      nominationsUnchanged: !buildSystemPrompt("nominations", view).includes("EDITED-FRAGMENT-XYZ"),
      baseUnchanged: BASE_GAME_MASTER_PROMPT === baseBefore,
      otherFragmentUnchanged: momentFragment("nominations") === otherBefore,
    });
  } finally {
    MOMENT_PROMPTS["social"] = original; // restore the shared registry
  }
});

Then("only that moment's system prompt changes", function (this: BbWorld) {
  const r = JSON.parse(this.lastOutput) as { socialChanged: boolean; nominationsUnchanged: boolean };
  assert.ok(r.socialChanged && r.nominationsUnchanged);
});

Then("the base persona and the other moments are unaffected", function (this: BbWorld) {
  const r = JSON.parse(this.lastOutput) as { baseUnchanged: boolean; otherFragmentUnchanged: boolean };
  assert.ok(r.baseUnchanged && r.otherFragmentUnchanged);
});
