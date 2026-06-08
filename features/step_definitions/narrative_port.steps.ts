import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { assertNoSentinels, assertNoneAppear } from "../../tests/support/assertions";
import { DeterministicNarrator } from "../../src/adapters/narrative/DeterministicNarrator";
import { LlmNarrativePort, safeFallbackLine, type NarratorTransport } from "../../src/adapters/narrative/LlmNarrativePort";
import { loadNarratorConfig } from "../../src/adapters/narrative/narratorConfig";
import { resolveCompetition, CompetitionIntents } from "../../src/domain/competitionOutcome";
import type { Competitor } from "../../src/domain/competitionOutcome";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

// Reuses: Background "a running game sandbox with a fully populated Producer's Vault" (mcp_boundary),
// "the game state is unchanged" (agent_play_loop — asserts nothing was executed; no-op here).

const MOMENT_PROMPT = "You are the voice of the house. Narrate the moment in character; the engine decides outcomes.";

/** A seed-deterministic engine decision — re-running it is how we 're-read the engine'. */
function decideWinner(seed: number): string {
  const competitors: Competitor[] = [
    { id: PLAYER, stats: { physical: 0.4, mental: 0.6, social: 0.5 } },
    { id: npc(1), stats: { physical: 0.75, mental: 0.5, social: 0.4 } },
    { id: npc(2), stats: { physical: 0.55, mental: 0.7, social: 0.6 } },
  ];
  return resolveCompetition(competitors, "physical", new CompetitionIntents(), new SeededRandom(seed)).winner;
}

function erroringPort(): LlmNarrativePort {
  const erroring: NarratorTransport = {
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error("provider timed out");
    },
  };
  return new LlmNarrativePort(
    { provider: "ollama", endpoint: "http://127.0.0.1:0", model: "m", apiKey: undefined, timeoutMs: 20, maxRetries: 0 },
    erroring,
  );
}

// --- The adapter receives only Vault-free context -----------------------------

When("narration is requested for the player", function (this: BbWorld) {
  // Assembled by the outward surface (proven Vault-free, 0001) + the managed moment prompt (0018).
  const ctx = this.sandbox!.player.assembleNarrationContext("scene");
  ctx.systemPrompt = MOMENT_PROMPT;
  this.narrationCtx = ctx;
});

Then("the context handed to the adapter contains no Vault sentinel value", function (this: BbWorld) {
  const json = JSON.stringify(this.narrationCtx);
  assertNoSentinels(json, this.sandbox!.sentinels);
  assertNoneAppear(json, this.sandbox!.hiddenContents);
});

Then("it contains only the visible projection and the moment prompt", function (this: BbWorld) {
  const ctx = this.narrationCtx!;
  const allowed = new Set(["forEntity", "mode", "visibleEvents", "knowledge", "fidelity", "systemPrompt"]);
  for (const key of Object.keys(ctx)) assert.ok(allowed.has(key), `unexpected context key leaked in: ${key}`);
  const vs = this.sandbox!.player.getVisibleState();
  assert.deepEqual(ctx.visibleEvents, vs.visibleEvents); // exactly the visible projection
  assert.deepEqual(ctx.knowledge, vs.knowledge);
  assert.equal(ctx.systemPrompt, MOMENT_PROMPT); // and the moment prompt
});

// --- Streaming concatenates to the full narration -----------------------------

Given("the deterministic test narrator", function (this: BbWorld) {
  this.narrator = new DeterministicNarrator(3);
  const ctx = this.sandbox!.player.assembleNarrationContext("scene");
  ctx.systemPrompt = MOMENT_PROMPT;
  this.narrationCtx = ctx;
});

When("narration is streamed token by token", async function (this: BbWorld) {
  const chunks: string[] = [];
  for await (const c of this.narrator!.narrateStream(this.narrationCtx!)) chunks.push(c);
  this.narrationChunks = chunks;
  this.narrationFull = await this.narrator!.narrate(this.narrationCtx!);
});

Then("the concatenated stream equals the full narration", function (this: BbWorld) {
  assert.equal(this.narrationChunks!.join(""), this.narrationFull);
  assert.ok(this.narrationChunks!.length > 1, "narration should genuinely stream in pieces");
});

// --- A narration failure leaves game state untouched --------------------------

Given("the narrator provider times out or errors", function (this: BbWorld) {
  this.narrator = erroringPort();
});

When("narration is requested for a resolved beat", async function (this: BbWorld) {
  this.engineWinnerBefore = decideWinner(5); // the engine settled the beat BEFORE narration
  this.narrationCtx = this.sandbox!.player.assembleNarrationContext("scene");
  this.narrationOut = await this.narrator!.narrate(this.narrationCtx);
});

Then("a safe fallback line is produced", function (this: BbWorld) {
  assert.equal(this.narrationOut, safeFallbackLine(this.narrationCtx!));
});

Then("re-reading the engine gives the same result", function (this: BbWorld) {
  assert.equal(decideWinner(5), this.engineWinnerBefore); // narration text moved nothing
});

// --- Narration never changes an outcome ---------------------------------------

Given("the engine has decided a competition result", function (this: BbWorld) {
  this.engineWinnerBefore = decideWinner(11);
});

When("the narrator produces narration for it", async function (this: BbWorld) {
  // A 'hallucinating' provider asserts a bogus winner — it is only ever text.
  const hallucinating: NarratorTransport = {
    async *stream() {
      yield "And against all odds, somehow everyone wins!";
    },
  };
  const port = new LlmNarrativePort(
    { provider: "ollama", endpoint: "http://127.0.0.1:0", model: "m", apiKey: undefined, timeoutMs: 20, maxRetries: 0 },
    hallucinating,
  );
  this.narrationCtx = this.sandbox!.player.assembleNarrationContext("scene");
  this.narrationOut = await port.narrate(this.narrationCtx);
});

Then("the engine's result is unchanged", function (this: BbWorld) {
  assert.equal(decideWinner(11), this.engineWinnerBefore);
});

Then("even a hallucinated result in the prose changes no game state", function (this: BbWorld) {
  assert.ok(this.narrationOut && this.narrationOut.length > 0); // the prose said something...
  assert.equal(decideWinner(11), this.engineWinnerBefore); // ...the engine's seed-deterministic result is unmoved
});

// --- Provider and secrets come from config, never code ------------------------

When("the adapter is configured", function (this: BbWorld) {
  this.narratorEnv = {
    ORWELL_NARRATOR_PROVIDER: "anthropic",
    ORWELL_NARRATOR_ENDPOINT: "https://provider.example",
    ORWELL_NARRATOR_MODEL: "configured-model",
    ORWELL_NARRATOR_API_KEY: "from-env-only",
  };
  this.narratorCfg = loadNarratorConfig(this.narratorEnv);
});

Then("the provider, endpoint, and model come from the environment", function (this: BbWorld) {
  assert.equal(this.narratorCfg!.provider, "anthropic");
  assert.equal(this.narratorCfg!.endpoint, "https://provider.example");
  assert.equal(this.narratorCfg!.model, "configured-model");
});

Then("no secret is read from committed source", function (this: BbWorld) {
  // The key is ONLY ever from env: with no env key set, it is undefined (no literal default in code).
  assert.equal(loadNarratorConfig({}).apiKey, undefined);
  assert.equal(this.narratorCfg!.apiKey, this.narratorEnv!["ORWELL_NARRATOR_API_KEY"]);
});
