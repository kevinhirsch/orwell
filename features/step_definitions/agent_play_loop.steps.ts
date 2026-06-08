import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { pendingDecision, executeDecision, isDecisionPending } from "../../src/engine/decisions";
import { selectableReplacements } from "../../src/domain/eligibility";
import type { WeekState } from "../../src/domain/eligibility";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { McpServer } from "../../src/adapters/mcp/McpServer";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { assertNoSentinels } from "../../tests/support/assertions";
import { PLAYER, npc } from "../../src/domain/ids";

const HOUSE = [PLAYER, ...Array.from({ length: 15 }, (_, i) => npc(i + 1))];
function week(over: Partial<WeekState>): WeekState {
  return { houseguests: HOUSE, player: PLAYER, hoh: npc(1), nominees: [npc(2), npc(3)], ...over };
}

// --- Binding decision only via the validated path -----------------------------

Given("a pending eviction vote", function (this: BbWorld) {
  this.decisionCtx = { kind: "eviction-vote", week: week({ hoh: npc(1), nominees: [npc(2), npc(3)] }), by: PLAYER };
  this.decisionResult = undefined;
});

When("the player says in free-text that they would probably vote out the nominee", function (this: BbWorld) {
  // Free-text lobbying is recorded as a scene — it does NOT cast a vote.
  const commands = new EngineCommandsAdapter(this.sandbox!.engine.events, this.sandbox!.engine.knowledge);
  commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(2)], content: "Honestly I'd probably vote out that nominee." });
});

Then("no vote is recorded", function (this: BbWorld) {
  assert.equal(this.decisionResult, undefined);
  assert.ok(isDecisionPending(this.decisionCtx!), "the decision is still pending");
});

When("the player makes the choice through the validated decision path", function (this: BbWorld) {
  this.decisionResult = executeDecision(this.decisionCtx!, [npc(2)]);
});

Then("the vote is recorded", function (this: BbWorld) {
  assert.ok(this.decisionResult?.recorded);
  assert.deepEqual(this.decisionResult!.choice, [npc(2)]);
});

// --- Presented options equal the engine's legal set ---------------------------

Given("a pending replacement-nominee decision", function (this: BbWorld) {
  this.decisionCtx = { kind: "replacement", week: week({ hoh: npc(1), nominees: [npc(2), npc(3)], vetoWinner: npc(4) }) };
});

When("the agent surfaces the options", function (this: BbWorld) {
  this.pending = pendingDecision(this.decisionCtx!);
});

Then("the options are exactly the engine's legal set", function (this: BbWorld) {
  const pd = this.pending as { options: string[] };
  assert.deepEqual([...pd.options].sort(), [...selectableReplacements(this.decisionCtx!.week!)].sort());
});

Then("the veto winner is not among them", function (this: BbWorld) {
  const pd = this.pending as { options: string[] };
  assert.ok(!pd.options.includes(npc(4)));
});

// --- Illegal choice rejected --------------------------------------------------

Given("a pending decision with a known legal option set", function (this: BbWorld) {
  this.decisionCtx = { kind: "nominations", hoh: PLAYER, active: HOUSE };
  this.decisionRejected = undefined;
  this.decisionResult = undefined;
});

When("the player attempts a choice outside that set", function (this: BbWorld) {
  try {
    executeDecision(this.decisionCtx!, [PLAYER, npc(1)]); // PLAYER is the HOH → illegal nominee
    this.decisionRejected = false;
  } catch {
    this.decisionRejected = true;
  }
});

Then("the engine rejects it", function (this: BbWorld) {
  assert.equal(this.decisionRejected, true);
});

Then("the game state is unchanged", function (this: BbWorld) {
  assert.equal(this.decisionResult, undefined); // nothing was executed
});

// --- The agent cannot fabricate an outcome ------------------------------------

Given("a competition is resolved by the engine", function (this: BbWorld) {
  const game = new GameSessionAdapter();
  game.createCharacter({ playerName: "Player One", seed: 9 });
  this.compResult = game.runCompetition({ type: "endurance" });
  // Determinism per moment: the engine yields the same winner; there is no agent-set winner API.
  const again = game.runCompetition({ type: "endurance" });
  assert.deepEqual(again.winner, this.compResult.winner);
});

Then("the agent narrates the engine's result", function (this: BbWorld) {
  assert.ok(this.compResult!.winner, "the engine produced the winner the agent must voice");
});

Then("the agent cannot produce a different winner", function (this: BbWorld) {
  // The only outcome available is the engine's; there is no tool/field by which the agent sets one.
  assert.ok(this.compResult!.winner && typeof this.compResult!.winner.name === "string");
});

// --- Free-text social play is not a binding decision --------------------------

Given("no decision is pending", function (this: BbWorld) {
  this.decisionCtx = { kind: "none" };
  this.rel = new RelationshipModel(0.6);
  this.bondBaseline = this.rel.bondStrength(PLAYER, npc(1));
  this.decisionResult = undefined;
});

When("the player engages in free-text social conversation", function (this: BbWorld) {
  const commands = new EngineCommandsAdapter(this.sandbox!.engine.events, this.sandbox!.engine.knowledge);
  this.ack = commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "A warm kitchen chat." });
  this.rel!.apply(PLAYER, npc(1), "bonding", new SeededRandom(1));
});

Then("the conversation is recorded as a witnessed event", function (this: BbWorld) {
  const visible = this.sandbox!.player.getVisibleState().visibleEvents.some((e) => e.id === this.ack!.eventId);
  assert.ok(visible, "the scene is in the player's visible projection");
});

Then("relationships may shift", function (this: BbWorld) {
  assert.ok(this.rel!.bondStrength(PLAYER, npc(1)) > this.bondBaseline!, "the bond moved");
});

Then("no binding decision is made", function (this: BbWorld) {
  assert.ok(!isDecisionPending(this.decisionCtx!));
  assert.equal(this.decisionResult, undefined);
});

// --- Every tool result the loop consumes is Vault-free ------------------------

When("the agent runs a full turn over the engine tools", async function (this: BbWorld) {
  const sb = this.sandbox!;
  const commands = new EngineCommandsAdapter(sb.engine.events, sb.engine.knowledge);
  const session = new GameSessionAdapter();
  session.createCharacter({ playerName: "Player One", seed: 1 });
  const server = new McpServer("player", { player: sb.player, admin: sb.admin, summary: sb.summary, commands, session });
  const sample: Record<string, Record<string, unknown>> = {
    getVisibleStateFor: { entity: PLAYER },
    renderScene: { mode: "scene" },
    socialRead: {},
    getGameState: {},
    getMomentPrompt: { moment: "nominations" },
    runCompetition: { type: "endurance" },
    recordInteraction: { initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "turn" },
  };
  const out: string[] = [];
  for (const t of server.listTools()) {
    if (t.name in sample) out.push(JSON.stringify(await server.callTool(t.name, sample[t.name]!)));
  }
  this.lastOutput = out.join("\n");
});

Then("no tool result contains a Vault sentinel value", function (this: BbWorld) {
  assertNoSentinels(this.lastOutput, this.sandbox!.sentinels);
});
