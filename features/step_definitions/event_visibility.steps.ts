import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { buildSandbox } from "../../tests/support/sandbox";
import { classify } from "../../src/domain/event";
import type { GameEvent } from "../../src/domain/event";
import { PLAYER, npc } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { simulateOffscreenStretch } from "../../src/engine/offscreen";

let evSeq = 0;
const nextId = (): string => `evt:0002:${++evSeq}`;

function record(world: BbWorld, ev: Omit<GameEvent, "id" | "ts"> & Partial<Pick<GameEvent, "id" | "ts">>): GameEvent {
  const full: GameEvent = { id: ev.id ?? nextId(), ts: ev.ts ?? evSeq, ...ev } as GameEvent;
  world.sandbox.engine.events.record(full);
  return full;
}

// --- Background ---------------------------------------------------------------

Given("a running game sandbox with a single event record", function (this: BbWorld) {
  this.sandbox = buildSandbox(1);
});

// --- Player-witnessed = knowledge, not hidden (scenarios 1 & 7 share this Given) ---

Given("an interaction whose witness set includes the player", function (this: BbWorld) {
  this.firstEvent = record(this, {
    type: "conversation", initiator: PLAYER, witnessSet: [PLAYER, npc(1)],
    hidden: false, content: "player-witnessed kitchen chat",
  });
});

Then("that interaction is part of the player's knowledge", function (this: BbWorld) {
  const witnessed = this.sandbox.engine.events.query({ witnessedBy: PLAYER });
  assert.ok(witnessed.some((e) => e.id === this.firstEvent!.id), "player should have witnessed it");
});

Then("it is not classified as off-screen or hidden", function (this: BbWorld) {
  assert.equal(classify(this.firstEvent!, PLAYER), "VISIBLE");
  assert.equal(this.firstEvent!.hidden, false);
});

// --- Visibility follows the witness set, not the store ------------------------

Given("two interactions with identical content", function (this: BbWorld) {
  this.factContent = "identical interaction content";
});

Given("the first has a witness set that includes the player", function (this: BbWorld) {
  this.firstEvent = record(this, {
    type: "conversation", initiator: PLAYER, witnessSet: [PLAYER, npc(1)],
    hidden: false, content: this.factContent!,
  });
});

Given("the second has a witness set that excludes the player", function (this: BbWorld) {
  this.secondEvent = record(this, {
    type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)],
    hidden: true, content: this.factContent!,
  });
});

Then("the first is visible to the player", function (this: BbWorld) {
  assert.equal(classify(this.firstEvent!, PLAYER), "VISIBLE");
});

Then("the second is hidden from the player", function (this: BbWorld) {
  assert.equal(classify(this.secondEvent!, PLAYER), "HIDDEN");
});

// --- Off-screen simulation ----------------------------------------------------

Given("a stretch of game time in which the player is absent", function (this: BbWorld) {
  this.offscreen = simulateOffscreenStretch({
    events: this.sandbox.engine.events,
    rng: new SeededRandom(123),
    npcs: [npc(1), npc(2), npc(3), npc(4), npc(5)],
    interactions: 10,
  });
});

Then(
  "NPC-to-NPC interactions occur with witness sets that exclude the player",
  function (this: BbWorld) {
    assert.ok(this.offscreen!.length > 0);
    assert.ok(this.offscreen!.every((e) => !e.witnessSet.includes(PLAYER)));
  },
);

Then(
  "they remain hidden from the player until surfaced by an in-game pathway",
  function (this: BbWorld) {
    const witnessed = this.sandbox.engine.events.query({ witnessedBy: PLAYER });
    const known = this.sandbox.engine.knowledge.knownTo(PLAYER);
    for (const e of this.offscreen!) {
      assert.equal(classify(e, PLAYER), "HIDDEN");
      assert.ok(!witnessed.some((w) => w.id === e.id));
      assert.ok(!known.some((k) => k.content === e.content));
    }
  },
);

// --- Propagation (scenarios 4 & 5 share the first Given) ----------------------

Given("a hidden interaction the player did not witness", function (this: BbWorld) {
  this.hiddenEvent = record(this, {
    type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)],
    hidden: true, content: "a secret final-two deal",
  });
});

Given("an NPC who witnessed it", function (this: BbWorld) {
  this.npc = npc(1); // in the hidden event's witness set
});

When("that NPC tells the player about it", function (this: BbWorld) {
  this.surfaced = this.sandbox.engine.knowledge.surfaceInformationTo(
    PLAYER, { content: this.hiddenEvent!.content }, `told-by:${this.npc}`,
  );
});

Then("that fact enters the player's knowledge state", function (this: BbWorld) {
  const known = this.sandbox.engine.knowledge.knownTo(PLAYER);
  assert.ok(known.some((k) => k.content === this.hiddenEvent!.content));
});

Then(
  "the surfacing is itself recorded as an event with a traceable pathway",
  function (this: BbWorld) {
    const fact = this.sandbox.engine.knowledge.knownTo(PLAYER).find(
      (k) => k.content === this.hiddenEvent!.content,
    );
    assert.ok(fact, "surfaced fact should exist");
    assert.equal(fact!.pathway, `told-by:${this.npc}`);
    assert.ok(fact!.sourceEventId, "fact must reference a surfacing event");
    const surfacing = this.sandbox.engine.events.query({ type: "surfacing" });
    assert.ok(surfacing.some((e) => e.id === fact!.sourceEventId), "surfacing event must be queryable");
  },
);

// --- No pathway, no access ----------------------------------------------------

Given("no in-game pathway has surfaced it", function (this: BbWorld) {
  const known = this.sandbox.engine.knowledge.knownTo(PLAYER);
  assert.ok(!known.some((k) => k.content === this.hiddenEvent!.content));
});

Then("the player has no access to that fact", function (this: BbWorld) {
  const witnessed = this.sandbox.engine.events.query({ witnessedBy: PLAYER });
  const known = this.sandbox.engine.knowledge.knownTo(PLAYER);
  assert.ok(!witnessed.some((w) => w.id === this.hiddenEvent!.id));
  assert.ok(!known.some((k) => k.content === this.hiddenEvent!.content));
});

// --- Knowledge vs suspicion ---------------------------------------------------

Given("a fact an NPC neither witnessed nor was told", function (this: BbWorld) {
  this.npc = npc(3);
  this.factContent = "a fact this NPC has no pathway to";
});

Then("that NPC does not know the fact", function (this: BbWorld) {
  const known = this.sandbox.engine.knowledge.knownTo(this.npc!);
  assert.ok(!known.some((k) => k.content === this.factContent));
});

Then(
  "the NPC may hold it only as a suspicion, never as knowledge",
  function (this: BbWorld) {
    this.sandbox.engine.knowledge.addSuspicion(this.npc!, { content: this.factContent! });
    const suspicions = this.sandbox.engine.knowledge.suspicionsOf(this.npc!);
    const known = this.sandbox.engine.knowledge.knownTo(this.npc!);
    assert.ok(suspicions.some((s) => s.content === this.factContent), "should be a suspicion");
    assert.ok(!known.some((k) => k.content === this.factContent), "must never be knowledge");
  },
);

// --- Regression guard: a witnessed event is never written as hidden -----------

When("the event record is classified", function (this: BbWorld) {
  this.classification = classify(this.firstEvent!, PLAYER);
});

// regex (not a Cucumber Expression) because the step text contains "/".
Then(
  /^it is never written to the hidden \/ off-screen classification$/,
  function (this: BbWorld) {
    assert.equal(this.classification, "VISIBLE");
    assert.equal(this.firstEvent!.hidden, false);
    // Structural: persisting a player-witnessed event as hidden is rejected.
    assert.throws(() =>
      this.sandbox.engine.events.record({ ...this.firstEvent!, id: "mislabeled", hidden: true }),
    );
  },
);

// --- Diary Room reaches no NPC ------------------------------------------------

Given("the player speaks privately in the Diary Room", function (this: BbWorld) {
  this.factContent = "my secret plan to backdoor the Head of Household";
  this.sandbox.engine.knowledge.recordDiaryRoom(this.factContent);
});

Then("that content is part of the player's own knowledge", function (this: BbWorld) {
  const known = this.sandbox.engine.knowledge.knownTo(PLAYER);
  assert.ok(known.some((k) => k.content === this.factContent));
});

Then("no NPC's knowledge state gains a pathway to it", function (this: BbWorld) {
  for (let i = 1; i <= 8; i++) {
    const known = this.sandbox.engine.knowledge.knownTo(npc(i));
    assert.ok(!known.some((k) => k.content === this.factContent), `npc:${i} must not know the DR content`);
  }
  // No event carrying the DR content has any non-player witness.
  const leaked = this.sandbox.engine.events
    .query()
    .filter((e) => e.content.includes(this.factContent!) && e.witnessSet.some((w) => w !== PLAYER));
  assert.equal(leaked.length, 0, "DR content must not reach any NPC via an event");
});
