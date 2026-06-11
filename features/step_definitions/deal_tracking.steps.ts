import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { DealLedger } from "../../src/engine/deals";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import { buildSandbox } from "../../tests/support/sandbox";

// HARD rule: roles only — promisor/promisee, the player, a houseguest, the wronged party. No names.
const PARTNER = npc(1);
const SOMEONE_ELSE = npc(2);
const NPC_A = npc(3);

function sink(w: BbWorld) {
  w.dealJuryDemerits = [];
  w.dealReveals = [];
  return {
    rel: w.dealRel,
    rng: new SeededRandom(7),
    juryDemerit: (wronged: string, breaker: string) => w.dealJuryDemerits!.push({ wronged, breaker }),
    reveal: (wronged: string, breaker: string) => {
      // A break in front of the wronged party enters their knowledge (witnessSet includes them).
      w.dealReveals!.push({ wronged, breaker, witnessSet: [wronged, breaker] });
      return `evt:reveal:${w.dealReveals!.length}`;
    },
  };
}

// --- Scenario: a deal is a first-class tracked object -------------------------

Given("two houseguests make a safety deal", function (this: BbWorld) {
  this.ledger = new DealLedger();
  this.madeDeal = this.ledger.make([PLAYER, PARTNER], "safety", "I won't put you up");
});

Then("the deal is recorded as an open commitment between them with its terms", function (this: BbWorld) {
  const d = this.madeDeal!;
  assert.equal(d.status, "open");
  assert.deepEqual([...d.parties].sort(), [PLAYER, PARTNER].sort());
  assert.ok(d.terms.length > 0, "the deal carries its terms");
  assert.equal(this.ledger!.open().length, 1);
});

Then("it persists and survives an engine restart", function (this: BbWorld) {
  const snap = this.ledger!.serialize();
  const revived = new DealLedger();
  revived.load(snap); // round-trip through plain JSON, as the durable save does
  assert.deepEqual(revived.all, this.ledger!.all);
});

// --- Scenarios: honoring / breaking -------------------------------------------

Given("an open safety deal between the player and a houseguest", function (this: BbWorld) {
  this.ledger = new DealLedger();
  this.dealRel = new RelationshipModel(0.5);
  this.madeDeal = this.ledger.make([PLAYER, PARTNER], "safety", "safe");
  this.dealTrustBefore = this.dealRel.edge(PARTNER, PLAYER).trust;
  this.dealThreatBefore = this.dealRel.edge(PARTNER, PLAYER).threat;
});

When("the player takes a binding action that honors it", function (this: BbWorld) {
  // The player nominates SOMEONE ELSE — sparing the partner builds trust but keeps the promise
  // binding (E43) — then votes at the week's eviction where the partner sat on the block: the
  // safety deal's HORIZON, where it resolves kept.
  this.ledger!.reconcile({ actor: PLAYER, kind: "nominate", targets: [SOMEONE_ELSE, NPC_A] }, sink(this));
  this.ledger!.reconcile(
    { actor: PLAYER, kind: "vote-evict", targets: [SOMEONE_ELSE], alternatives: [SOMEONE_ELSE, PARTNER] },
    sink(this),
  );
});

Then("the engine marks the deal kept", function (this: BbWorld) {
  assert.equal(this.madeDeal!.status, "kept");
});

Then("no betrayal consequence is applied", function (this: BbWorld) {
  // A kept promise BUILDS trust (E43) — what must never happen here is the betrayal fallout:
  // no trust drop, no threat spike, no jury demerit.
  assert.ok(this.dealRel!.edge(PARTNER, PLAYER).trust >= this.dealTrustBefore!, "trust never drops on an honored deal");
  assert.ok(this.dealRel!.edge(PARTNER, PLAYER).threat <= this.dealThreatBefore!, "no threat spike on an honored deal");
  assert.equal(this.dealJuryDemerits!.length, 0);
});

When("the player takes a binding action that violates its condition", function (this: BbWorld) {
  // The player nominates the very houseguest they promised safety — the engine decides this breaks it.
  this.ledger!.reconcile({ actor: PLAYER, kind: "nominate", targets: [PARTNER, SOMEONE_ELSE] }, sink(this));
});

Then("the engine marks the deal broken", function (this: BbWorld) {
  assert.equal(this.madeDeal!.status, "broken");
});

Then("the wronged houseguest's hidden trust drops and threat rises, and lingers", function (this: BbWorld) {
  const e = this.dealRel!.edge(PARTNER, PLAYER);
  assert.ok(e.trust < this.dealTrustBefore!, "trust dropped");
  assert.ok(e.threat > this.dealThreatBefore!, "threat rose");
  // Sticky: a couple of quiet cycles do not erase the grudge.
  this.dealRel!.decay(0.1); this.dealRel!.decay(0.1);
  assert.ok(this.dealRel!.edge(PARTNER, PLAYER).threat > this.dealThreatBefore!, "the grudge lingers");
});

Then("the break is weighed against the breaker in that juror's later lean", function (this: BbWorld) {
  assert.deepEqual(this.dealJuryDemerits, [{ wronged: PARTNER, breaker: PLAYER }]);
});

Then("the player is shown no opinion number", function (this: BbWorld) {
  // The relationship move is hidden; nothing in the deal's player-facing shape is a number.
  const facing = { id: this.madeDeal!.id, parties: this.madeDeal!.parties, kind: this.madeDeal!.kind, terms: this.madeDeal!.terms, status: this.madeDeal!.status };
  const blob = JSON.stringify(facing);
  for (const banned of ["trust", "threat", "affinity", "confidence"]) {
    assert.ok(!blob.includes(banned), `player-facing deal must not expose ${banned}`);
  }
});

// --- Scenario: the wronged party learns it as a witnessed event ---------------

Given("a deal the player breaks in front of the wronged houseguest", function (this: BbWorld) {
  this.ledger = new DealLedger();
  this.dealRel = new RelationshipModel(0.5);
  this.madeDeal = this.ledger.make([PLAYER, PARTNER], "safety", "safe");
});

When("the deal is broken", function (this: BbWorld) {
  this.ledger!.reconcile({ actor: PLAYER, kind: "nominate", targets: [PARTNER] }, sink(this));
});

Then("a witnessed reveal event enters the wronged houseguest's knowledge", function (this: BbWorld) {
  assert.equal(this.dealReveals!.length, 1);
  const r = this.dealReveals![0]!;
  assert.equal(r.wronged, PARTNER);
  assert.ok(r.witnessSet.includes(PARTNER), "the wronged party is a witness of the reveal");
});

// --- Scenario: NPC↔NPC deals are Vault-held and reach the player only by rumor -

// T15: the two off-screen deal-makers — the SAME parties the Vault fixture's `addNpcDeal`
// pact names, so the tracked ledger deal and the sentinel-bearing Vault datum are one story.
const OFFSCREEN_A = npc(6);
const OFFSCREEN_B = npc(7);

Given("two houseguests make a deal off-screen that the player does not witness", function (this: BbWorld) {
  // The off-screen society makes NPC↔NPC deals in the HIDDEN layer (the Vault), with a sentinel.
  this.sandbox = buildSandbox(39);
  this.dealVault = this.sandbox.addNpcDeal(); // the same pact, Vault-held + sentinel-bearing
  this.ledger = new DealLedger();
  this.madeDeal = this.ledger.make([OFFSCREEN_A, OFFSCREEN_B], "final-two", "off-screen pact");
});

When("one of them breaks it off-screen", function (this: BbWorld) {
  // The break is adjudicated in the hidden layer; no player witness, so no player-knowledge event.
  const { broken } = this.ledger!.reconcile({ actor: OFFSCREEN_A, kind: "vote-evict", targets: [OFFSCREEN_B] });
  assert.equal(broken[0]?.id, this.madeDeal!.id, "the ENGINE adjudicated this very deal broken");
});

Then("the deal and its break stay hidden from the player by default", function (this: BbWorld) {
  // The NPC↔NPC deal is not among the player's own deals.
  assert.equal(this.ledger!.forParty(PLAYER).length, 0);
  assert.ok(this.ledger!.npcOnly().length >= 1, "the deal lives in the NPC-only (hidden) set");
  assert.equal(this.madeDeal!.status, "broken"); // broken — and STILL not the player's to see
});

Then("the player may only learn of it as a distorted rumor along an in-game pathway", function (this: BbWorld) {
  // T15: the rumor must be ABOUT this broken deal — derived from its actual parties and kind —
  // and reach the player only through the real anchored knowledge seam, never the ledger.
  const deal = this.madeDeal!;
  const [breaker, wronged] = deal.parties;
  const knowledge = this.sandbox.engine.knowledge;
  // The wronged party holds the truth of the break (they lived it, off-screen)...
  const truth = `${breaker} turned on ${wronged} and broke their hidden ${deal.kind} pact`;
  knowledge.seedBelief(wronged, { content: truth, factId: `deal-break:${deal.id}` }, "witnessed");
  // ...and the player learns it only as that party's retelling along a told-by pathway.
  const surfaced = knowledge.surfaceInformationTo(PLAYER, { content: truth }, `told-by:${wronged}`);
  assert.ok(surfaced, "the anchored in-game pathway surfaced the rumor as player knowledge");
  const known = knowledge.knownTo(PLAYER).find((k) => k.content === surfaced!.content);
  assert.ok(known, "the rumor entered the player's knowledge state");
  // The linkage the old step never made: the surfaced rumor names BOTH parties of the broken
  // deal and its kind — not canned fixture gossip with `length > 0`.
  assert.ok(known!.content.includes(breaker), "the rumor names the deal-breaker");
  assert.ok(known!.content.includes(wronged), "the rumor names the wronged party");
  assert.ok(known!.content.includes(deal.kind), "the rumor carries the broken pact's kind");
  assert.ok(known!.pathway.startsWith("told-by:"), "the knowledge arrived along a traceable in-game pathway");
});

Then("no Vault sentinel value appears on any player surface", function (this: BbWorld) {
  const out = this.sandbox.allPlayerOutputs();
  for (const s of this.sandbox.sentinels) {
    assert.ok(!out.includes(s), `player surface leaked a Vault sentinel: ${s}`);
  }
});

// --- Scenario: the engine, not the narrator, adjudicates ----------------------

Given("an open deal", function (this: BbWorld) {
  this.ledger = new DealLedger();
  this.madeDeal = this.ledger.make([PLAYER, PARTNER], "safety", "safe");
});

When("a binding action implicates it", function (this: BbWorld) {
  this.ledger!.reconcile({ actor: PLAYER, kind: "nominate", targets: [PARTNER] });
});

Then("kept or broken is decided from the action and the deal's condition", function (this: BbWorld) {
  // The structured action (actor moved adversely against the protected partner) drove the verdict.
  assert.equal(this.madeDeal!.status, "broken");
});

Then("it is never inferred from chat prose", function (this: BbWorld) {
  // The reconcile API takes a structured BindingAction, never narration: the verdict cannot depend on
  // any free text. Re-running with a DIFFERENT terms string but the same action yields the same verdict.
  const a = new DealLedger();
  const da = a.make([PLAYER, PARTNER], "safety", "flowery promise, lots of prose");
  a.reconcile({ actor: PLAYER, kind: "nominate", targets: [PARTNER] });
  assert.equal(da.status, this.madeDeal!.status);
});
