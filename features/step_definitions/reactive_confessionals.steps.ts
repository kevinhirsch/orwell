import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import type { BbWorld } from "../support/world";
import { confessionalFor, selectRecentForConfessional, recordConfessionalToSoul } from "../../src/engine/confessionals";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { SoulStore } from "../../src/adapters/engine/SoulStore";
import { DeterministicEmbedding } from "../../src/adapters/embedding/DeterministicEmbedding";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { PLAYER, npc } from "../../src/domain/ids";
import type { GameEvent } from "../../src/domain/event";
import type { ConfessionalContext } from "../../src/engine/confessionals";

const fake = new DeterministicEmbedding();
const embed = (t: string): number[] => fake.embed(t);

const A = npc(1);
const B = npc(2);
const C = npc(3);
const D = npc(4);

function ev(overrides: Partial<GameEvent> & { ts?: number; witnessSet?: string[] }): GameEvent {
  return {
    id: `e:${Math.random().toString(36).slice(2)}`,
    ts: overrides.ts ?? 10,
    type: overrides.type ?? "conversation",
    initiator: overrides.initiator ?? A,
    witnessSet: overrides.witnessSet ?? [A],
    hidden: overrides.hidden ?? true,
    content: overrides.content ?? "a scene",
  };
}

// --- Background ---

Given("a started season with recorded events in the house", function () {
  // Semantic framing only — each scenario sets up its own test state in its own Given steps.
});

// --- Shared When: that houseguest gives their confessional ---
// Each scenario's Given sets up `confRel`, `confessor`, `confTrigger`, and optionally `recentEventsArg`.
// This single When reads that state and calls confessionalFor.

When("that houseguest gives their confessional", function (this: BbWorld) {
  const ctx: ConfessionalContext = {};
  if (this.confTrigger) ctx.trigger = this.confTrigger;
  if (this.recentEventsArg && this.recentEventsArg.length > 0) ctx.recentEvents = this.recentEventsArg;
  if (this.confRng) ctx.rng = this.confRng;
  this.confessional = confessionalFor(this.confessor!, [A, B, C], this.confRel!, ctx);
});

// --- Scenario 1: a confessional references the concrete beat ---

Given("a houseguest who was just left on the block at the veto ceremony", function (this: BbWorld) {
  const r = new RelationshipModel(0.5);
  const rng = new SeededRandom(7);
  for (let i = 0; i < 6; i++) r.applyDirected(A, B, "betrayal", rng);
  for (let i = 0; i < 4; i++) r.applyDirected(A, C, "bonding", rng);
  this.confRel = r;
  this.confessor = A;
  this.confTrigger = "the veto ceremony";
  this.recentEventsArg = [
    { type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" },
  ];
});

Then("the confessional references that recent veto-ceremony event", function (this: BbWorld) {
  assert.ok(this.confessional!.content.includes("the veto ceremony"), "confessional references the veto ceremony");
});

Then("it still names their engine-grounded biggest threat and most-trusted ally", function (this: BbWorld) {
  assert.equal(this.confessional!.target, B, "target is the biggest threat");
  assert.ok(this.confessional!.content.includes(B), "names the target");
  assert.equal(this.confessional!.ally, C, "ally is the most-trusted");
  assert.ok(this.confessional!.content.includes(C), "names the ally");
});

Then("the recent event it reacts to comes from that houseguest's own witnessed events", function (this: BbWorld) {
  assert.ok(this.recentEventsArg!.length > 0, "a recent event was supplied");
  assert.equal(this.recentEventsArg![0]!.type, "veto-ceremony");
});

// --- Scenario 2: degrades to grounded read when no qualifying event ---

Given("a houseguest with no salient recent event in the recency window", function (this: BbWorld) {
  const r = new RelationshipModel(0.5);
  const rng = new SeededRandom(3);
  for (let i = 0; i < 6; i++) r.applyDirected(A, B, "betrayal", rng);
  for (let i = 0; i < 4; i++) r.applyDirected(A, C, "bonding", rng);
  this.confRel = r;
  this.confessor = A;
  this.confTrigger = "the nomination ceremony";
  this.confRng = new SeededRandom(11);
  // No recentEventsArg set — simulates no qualifying recent events
  this.confessional0040 = confessionalFor(A, [A, B, C], r, { trigger: "the nomination ceremony", rng: new SeededRandom(11) });
});

Then("the confessional falls back to the standing target-and-ally read", function (this: BbWorld) {
  assert.equal(this.confessional!.content, this.confessional0040!.content,
    "when recentEvents absent, output is byte-identical to 0040");
  assert.equal(this.confessional!.target, B);
  assert.equal(this.confessional!.ally, C);
});

Then("no recent event is fabricated", function (this: BbWorld) {
  assert.ok(!this.confessional!.content.includes("I witnessed"), "no reactive opening when no events");
  assert.ok(!this.confessional!.content.includes("I was at the center of"), "no reactive opening");
});

// --- Scenario 3: events are selected by the engine, not invented ---

Given("a houseguest with several recent witnessed events", function (this: BbWorld) {
  this.npcEventStore = new InMemoryEventStore();
  const store = this.npcEventStore;
  store.record(ev({ type: "conversation", initiator: A, witnessSet: [A, B], ts: 1 }));
  store.record(ev({ type: "house-event", initiator: B, witnessSet: [A, B], ts: 2 }));
  store.record(ev({ type: "competition", initiator: A, witnessSet: [A, B, C, D], ts: 3 }));
  store.record(ev({ type: "nominations", initiator: C, witnessSet: [A, B, C, D], ts: 4 }));
  store.record(ev({ type: "confessional", initiator: A, witnessSet: [A], ts: 5 }));
  this.confessor = A;
});

When("the engine builds that houseguest's confessional context", function (this: BbWorld) {
  const events = this.npcEventStore!.query({ witnessedBy: this.confessor! });
  this.confRecentEvents = selectRecentForConfessional(events, this.confessor!);
});

Then("the recent events in the context are drawn from the recorded event store", function (this: BbWorld) {
  assert.ok(this.confRecentEvents!.length > 0, "events were selected from the recorded store");
});

Then("every selected event is one whose witness set includes that houseguest", function (this: BbWorld) {
  const allEvents = this.npcEventStore!.query();
  for (const r of this.confRecentEvents!) {
    const match = allEvents.find((e) => e.type === r.type);
    assert.ok(match, `selected event type ${r.type} exists in the store`);
    assert.ok(match!.witnessSet.includes(this.confessor!), `event ${r.type} was witnessed by the confessor`);
  }
});

Then("no event outside that houseguest's witness set is selected", function (this: BbWorld) {
  const allEvents = this.npcEventStore!.query();
  for (const r of this.confRecentEvents!) {
    const e = allEvents.find((x) => x.type === r.type);
    assert.ok(e && e.witnessSet.includes(this.confessor!), `selected event ${r.type} is in confessor's witness set`);
  }
});

// --- Scenario 4: a confessional never asserts a fabricated outcome ---

Given("a houseguest reacting to a recent competition they played", function (this: BbWorld) {
  const r = new RelationshipModel(0.5);
  const rng = new SeededRandom(5);
  for (let i = 0; i < 6; i++) r.applyDirected(A, B, "betrayal", rng);
  for (let i = 0; i < 4; i++) r.applyDirected(A, C, "bonding", rng);
  this.confRel = r;
  this.confessor = A;
  this.confTrigger = "the HOH competition";
  this.recentEventsArg = [
    { type: "competition", role: "participant" as const, gist: "the competition" },
  ];
});

Then("the confessional reacts to the recorded result only", function (this: BbWorld) {
  assert.ok(this.confessional!.content.includes("the competition"), "reacts to the competition event");
});

Then("it states no competition result, vote tally, or nomination the engine did not produce", function (this: BbWorld) {
  assert.ok(!this.confessional!.content.match(/won|placed|scored|eliminated/), "no fabricated result");
  assert.ok(!this.confessional!.content.match(/\d+[\s-]+\d+/), "no fabricated tally");
  assert.ok(this.confessional!.target === B, "target is still engine-grounded");
});

// --- Scenario 5: the reactive confessional reaches no one ---

Given("a houseguest gives a confessional reacting to a recent beat", function (this: BbWorld) {
  const events = new InMemoryEventStore();
  const r = new RelationshipModel(0.5);
  const rng = new SeededRandom(9);
  for (let i = 0; i < 6; i++) r.applyDirected(A, B, "betrayal", rng);
  const conf = confessionalFor(A, [A, B, C], r, {
    trigger: "the veto ceremony",
    recentEvents: [{ type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" }],
  });
  events.record({
    id: "conf:reactive:1",
    ts: 100,
    type: "confessional",
    initiator: A,
    witnessSet: [A],
    hidden: true,
    content: conf.content,
  });
  this.reactiveEventStore = events;
  this.reactiveConf = conf;
});

Then("the confessional is recorded witnessed by that houseguest alone and hidden", function (this: BbWorld) {
  const all = this.reactiveEventStore!.query();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.hidden, true);
  assert.deepEqual(all[0]!.witnessSet, [A]);
});

Then("it never appears on any player-facing surface", function (this: BbWorld) {
  const playerEvents = this.reactiveEventStore!.query({ witnessedBy: PLAYER });
  assert.equal(playerEvents.length, 0, "no confessional visible to player");
});

Then("it never appears on the admin or God-Mode surface", function (this: BbWorld) {
  const all = this.reactiveEventStore!.query();
  for (const e of all) {
    assert.ok(!e.witnessSet.includes(PLAYER), "admin surface does not witness the confessional");
  }
});

// --- Scenario 6: the reaction carries no other's sealed state and no number ---

Given("a houseguest whose confessional reacts to a scene they were part of", function (this: BbWorld) {
  const r = new RelationshipModel(0.5);
  const rng = new SeededRandom(13);
  for (let i = 0; i < 6; i++) r.applyDirected(A, B, "betrayal", rng);
  for (let i = 0; i < 4; i++) r.applyDirected(A, C, "bonding", rng);
  this.confRel = r;
  this.confessor = A;
  this.confTrigger = "a house meeting";
  this.recentEventsArg = [
    { type: "conversation", role: "initiator" as const, gist: "a conversation" },
  ];
});

When("the confessional content and its context are assembled", function (this: BbWorld) {
  this.confessional = confessionalFor(this.confessor!, [A, B, C], this.confRel!, {
    trigger: "a house meeting",
    recentEvents: this.recentEventsArg,
  });
});

Then("the assembled content contains no other houseguest's hidden read", function (this: BbWorld) {
  const content = this.confessional!.content;
  assert.ok(!content.includes(D), "no unrelated houseguest leaked");
  assert.ok(!content.includes("hidden"), "no hidden marker");
  assert.ok(!content.includes("secret"), "no secret marker");
  assert.ok(!content.includes("vault"), "no vault marker");
});

Then("it contains no hidden number", function (this: BbWorld) {
  const content = this.confessional!.content;
  assert.ok(!content.match(/[0-9]+\.[0-9]+/), "no floating-point number leaked");
  assert.ok(!content.match(/[-]\d+/), "no signed integer leaked");
});

// --- Scenario 7: the same history yields the same reaction ---

Given("two runs of the same season from the same seed and the same recorded history", function (this: BbWorld) {
  const r1 = new RelationshipModel(0.5);
  const r2 = new RelationshipModel(0.5);
  const rng1 = new SeededRandom(17);
  const rng2 = new SeededRandom(17);
  for (let i = 0; i < 6; i++) { r1.applyDirected(A, B, "betrayal", rng1); r2.applyDirected(A, B, "betrayal", rng2); }
  for (let i = 0; i < 4; i++) { r1.applyDirected(A, C, "bonding", rng1); r2.applyDirected(A, C, "bonding", rng2); }
  this.confRel = r1;
  this.confRelB = r2;
  this.confessor = A;
  this.confTrigger = "the veto ceremony";
  this.confRng = new SeededRandom(21);
  this.recentEventsArg = [
    { type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" },
  ];
});

When("a houseguest gives their confessional in each run", function (this: BbWorld) {
  this.confessional = confessionalFor(this.confessor!, [A, B, C], this.confRel!, {
    trigger: "the veto ceremony",
    rng: new SeededRandom(21),
    recentEvents: this.recentEventsArg,
  });
  this.confessionalB = confessionalFor(this.confessor!, [A, B, C], this.confRelB!, {
    trigger: "the veto ceremony",
    rng: new SeededRandom(21),
    recentEvents: this.recentEventsArg,
  });
});

Then("both runs produce the same confessional reacting to the same recent event", function (this: BbWorld) {
  assert.equal(this.confessional!.content, this.confessionalB!.content);
  assert.ok(this.confessional!.content.includes("the veto ceremony"));
});

Then("the confessional appends to that houseguest's soul without losing earlier ones", function (this: BbWorld) {
  const soul = new SoulStore(embed);
  const rel = new RelationshipModel(0.5);
  const rng = new SeededRandom(23);
  for (let i = 0; i < 6; i++) rel.applyDirected(A, B, "betrayal", rng);
  recordConfessionalToSoul(soul, confessionalFor(A, [A, B, C], rel, {
    recentEvents: [{ type: "nominations", role: "initiator" as const, gist: "the nomination ceremony" }],
  }));
  const afterOne = soul.soulOf(A).memories.length;
  for (let i = 0; i < 10; i++) rel.applyDirected(A, C, "betrayal", rng);
  recordConfessionalToSoul(soul, confessionalFor(A, [A, B, C], rel, {
    recentEvents: [{ type: "veto-ceremony", role: "participant" as const, gist: "the veto ceremony" }],
  }));
  const mems = soul.soulOf(A).memories;
  assert.ok(mems.length > afterOne, "confessionals accumulate");
  assert.ok(mems.some((m) => m.content.includes(B)), "earliest confessional (naming B) is retained");
});
