import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { EngineCommandsAdapter } from "../../src/adapters/engine/EngineCommandsAdapter";
import { npcInitiatedApproaches, rankApproaches, npcExpress } from "../../src/engine/conversation";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { pendingNominationDecision, validateNominations } from "../../src/engine/season";
import { assertNoSentinels, assertNoneAppear } from "../../tests/support/assertions";
import { PLAYER, npc } from "../../src/domain/ids";

// Background ("a running game sandbox with a fully populated Producer's Vault") and
// "the player holds power at a decision point" are defined in mcp_boundary / weekly_loop steps.

// --- Player-initiated scene → player knowledge --------------------------------

When("the player approaches a houseguest and speaks with them", function (this: BbWorld) {
  const commands = new EngineCommandsAdapter(this.sandbox!.engine.events, this.sandbox!.engine.knowledge);
  const { eventId } = commands.recordInteraction({
    initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "You pulled a houseguest aside in the kitchen.",
  });
  this.sceneEventId = eventId;
});

Then("the scene is recorded as an event whose witness set includes the player", function (this: BbWorld) {
  const ev = this.sandbox!.engine.events.query({ witnessedBy: PLAYER }).find((e) => e.id === this.sceneEventId);
  assert.ok(ev, "the scene event is recorded and witnessed by the player");
  assert.ok(ev!.witnessSet.includes(PLAYER));
});

Then("it is part of the player's knowledge, not the Vault", function (this: BbWorld) {
  const ev = this.sandbox!.engine.events.query({ witnessedBy: PLAYER }).find((e) => e.id === this.sceneEventId)!;
  // Player-witnessed ⇒ not hidden ⇒ surfaces in the player's visible projection (0002).
  assert.equal(ev.hidden, false);
  const visible = this.sandbox!.player.getVisibleState().visibleEvents.some((e) => e.id === this.sceneEventId);
  assert.ok(visible, "the scene is in the player's visible projection");
});

// --- Bidirectional initiation -------------------------------------------------

Given("a stretch of game time", function (this: BbWorld) {
  // A relationship field where two houseguests have a clear agenda toward the player:
  // one a warm ally, one who reads the player as a threat. The rest are lukewarm.
  const rel = new RelationshipModel(0.5);
  rel.edge(npc(2), PLAYER).trust = 0.9;
  rel.edge(npc(2), PLAYER).affinity = 0.9;
  rel.edge(npc(5), PLAYER).threat = 0.85;
  this.rel = rel;
  this.seed = 11;
});

Then("some scenes are initiated by houseguests approaching the player", function (this: BbWorld) {
  const npcs = [npc(1), npc(2), npc(3), npc(4), npc(5)];
  this.approaches = npcInitiatedApproaches(PLAYER, npcs, this.rel!, new SeededRandom(this.seed!), 3);
  assert.ok(this.approaches.length > 0, "houseguests initiate scenes with the player");
});

Then("which houseguest approaches reflects their agenda and relationships, not chance", function (this: BbWorld) {
  const npcs = [npc(1), npc(2), npc(3), npc(4), npc(5)];
  // Relationship-driven: the warm ally and the threatened rival both surface as
  // initiators across every seed, and the same seed reproduces the same approaches.
  for (let seed = 1; seed <= 20; seed++) {
    const a = npcInitiatedApproaches(PLAYER, npcs, this.rel!, new SeededRandom(seed), 3);
    assert.ok(a.includes(npc(2)) && a.includes(npc(5)), `seed ${seed}: agenda-driven approaches`);
  }
  const r1 = npcInitiatedApproaches(PLAYER, npcs, this.rel!, new SeededRandom(7), 3);
  const r2 = npcInitiatedApproaches(PLAYER, npcs, this.rel!, new SeededRandom(7), 3);
  assert.deepEqual(r1, r2, "deterministic by seed — not chance");
  assert.ok([npc(2), npc(5)].includes(rankApproaches(PLAYER, npcs, this.rel!, new SeededRandom(7))[0]!.npc));
});

// --- Social read --------------------------------------------------------------

When("the player asks for the energy in the room or a read on a houseguest", function (this: BbWorld) {
  // Give the player a pathway-free hunch so the read demonstrably *hints*.
  this.sandbox!.engine.knowledge.addSuspicion(PLAYER, { content: "the mood between two houseguests has cooled" });
  this.lastOutput = this.sandbox!.player.socialRead(npc(1));
});

Then("an honest, character-appropriate read is returned", function (this: BbWorld) {
  assert.ok(this.lastOutput.length > 0, "a read is returned");
});

Then("it may hint at off-screen shifts without naming any off-screen event", function (this: BbWorld) {
  assert.match(this.lastOutput, /unsettled|isn't telling you everything/i);
  // Hints, but never names an off-screen event or carries its content.
  assertNoneAppear(this.lastOutput, this.sandbox!.hiddenContents);
});

// --- Knowledge-constrained dialogue -------------------------------------------

Given("a hidden fact a houseguest neither witnessed nor was told", function (this: BbWorld) {
  this.npc = npc(3);
  this.factContent = "the HOH is planning a backdoor";
  // It exists in the hidden layer (off-screen), but this houseguest has no pathway to it.
  this.sandbox!.engine.vault.writeHidden({ id: "vault:0012", kind: "hidden-thread", content: this.factContent });
});

When("that houseguest speaks with the player", function (this: BbWorld) {
  const known = this.sandbox!.engine.knowledge.knownTo(this.npc!);
  const suspicions = this.sandbox!.engine.knowledge.suspicionsOf(this.npc!);
  this.expression = npcExpress({ content: this.factContent! }, known, suspicions);
});

Then("its dialogue never asserts that fact", function (this: BbWorld) {
  assert.notEqual(this.expression!.mode, "assert");
  if (this.expression!.content) assert.ok(!this.expression!.content.includes(this.factContent!) || this.expression!.mode === "suspect");
});

Then("at most it expresses suspicion, never knowledge", function (this: BbWorld) {
  assert.ok(["suspect", "silent"].includes(this.expression!.mode), `mode was ${this.expression!.mode}`);
});

// --- Hybrid decisions (explicit + validated, never from prose) ----------------

When("the player lobbies houseguests in free-text", function (this: BbWorld) {
  this.pendingBefore = pendingNominationDecision(this.playerState!);
  const commands = new EngineCommandsAdapter(this.sandbox!.engine.events, this.sandbox!.engine.knowledge);
  // Free-text lobbying is just recorded conversation — it must not move the binding choice.
  commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(1)], content: "Please don't put me up — target someone else." });
  commands.recordInteraction({ initiator: PLAYER, witnessSet: [PLAYER, npc(2)], content: "I'd never come after you." });
});

Then("the binding choice is not changed by that conversation", function (this: BbWorld) {
  assert.deepEqual(pendingNominationDecision(this.playerState!), this.pendingBefore);
});

Then("the choice is made only via an explicit prompt over the legal options", function (this: BbWorld) {
  const pd = pendingNominationDecision(this.playerState!);
  assert.equal(pd.kind, "nominations");
  assert.ok(pd.options.length >= 2 && !pd.options.includes(this.playerState!.hoh));
  // A legal explicit choice over those options validates.
  assert.doesNotThrow(() => validateNominations(this.playerState!, [pd.options[0]!, pd.options[1]!]));
});

Then("an illegal choice is rejected with a reason", function (this: BbWorld) {
  assert.throws(() => validateNominations(this.playerState!, [this.playerState!.hoh, npc(1)]), /illegal|nominate/i);
  assert.throws(() => validateNominations(this.playerState!, [npc(1), npc(1)]), /same|twice/i);
});

// --- Player-directed scene fidelity -------------------------------------------

When("the player requests a compressed beat or a full scene", function (this: BbWorld) {
  this.groundTruthBefore = JSON.stringify(this.sandbox!.player.getVisibleState());
  this.compressed = this.sandbox!.player.renderScene("compressed");
  this.full = this.sandbox!.player.renderScene("full");
});

Then("the narration is rendered at that fidelity", function (this: BbWorld) {
  assert.match(this.compressed!, /compressed/);
  assert.match(this.full!, /full/);
  assert.notEqual(this.compressed, this.full, "fidelity is reflected in the narration");
});

Then("the underlying ground truth is unchanged", function (this: BbWorld) {
  assert.equal(JSON.stringify(this.sandbox!.player.getVisibleState()), this.groundTruthBefore);
});

// --- Vault-free conversation surfaces (Scenario Outline) ----------------------

When("the engine produces {string} for the player", function (this: BbWorld, surface: string) {
  const p = this.sandbox!.player;
  this.lastOutput =
    surface === "scene" ? p.produce("scene narration")
      : surface === "NPC dialogue" ? p.produce("NPC dialogue")
        : surface === "social read" ? p.socialRead()
          : (() => { throw new Error(`unknown surface ${surface}`); })();
});

Then("it contains no Vault sentinel value", function (this: BbWorld) {
  assertNoSentinels(this.lastOutput, this.sandbox!.sentinels);
});
