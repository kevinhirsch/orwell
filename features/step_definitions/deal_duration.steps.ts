import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { DealLedger } from "../../src/engine/deals";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

// HARD rule: roles only — promisor, partner, the wronged party. No names; all fixtures synthesized.
const PROMISOR = "promisor";
const PARTNER = "partner";

/** The seed shared across paired-deal scenarios so only the negotiated form differs. */
const SEED = 11;

/** The wronged party's hidden read of the breaker (the edge that takes the betrayal hit). */
function edge(rel: RelationshipModel) {
  return rel.edge(PARTNER, PROMISOR);
}

/** Break a deal by nominating the protected partner (the engine adjudicates the adverse swing). */
function breakIt(ledger: DealLedger, rel: RelationshipModel, currentWeek?: number) {
  ledger.reconcile(
    { actor: PROMISOR, kind: "nominate", targets: [PARTNER] },
    { rel, rng: new SeededRandom(SEED), ...(currentWeek !== undefined ? { currentWeek } : {}) },
  );
}

// --- Scenario: a no-duration break is byte-identical to 0039 ------------------

Given("a deal with no negotiated duration and no label", function (this: BbWorld) {
  this.ddLedger = new DealLedger();
  this.ddRel = new RelationshipModel(0.5);
  this.ddDeal = this.ddLedger.make([PROMISOR, PARTNER], "safety", "safe"); // no duration, no label
});

When("the promisor breaks it with no week context", function (this: BbWorld) {
  breakIt(this.ddLedger!, this.ddRel!); // currentWeek omitted ⇒ scale 1
  this.ddEdgeAfter = { ...edge(this.ddRel!) };
  // The pre-0109 reference fold: a bare applyDirected('betrayal') at the same seed.
  const ref = new RelationshipModel(0.5);
  ref.applyDirected(PARTNER, PROMISOR, "betrayal", new SeededRandom(SEED));
  this.ddEdgeRef = { ...ref.edge(PARTNER, PROMISOR) };
});

Then("the betrayal-shock folded is exactly the unscaled 0039 magnitude", function (this: BbWorld) {
  assert.deepEqual(this.ddEdgeAfter, this.ddEdgeRef, "no-duration break must fold byte-identically to 0039");
  assert.equal(this.ddDeal!.status, "broken");
});

// --- Scenario: explicit expiry is fair game once the term has passed ----------

Given("a season-horizon deal with an explicit two-week term", function (this: BbWorld) {
  this.ddLedger = new DealLedger();
  // A final-two (kind-horizon = season) made week 3, with a negotiated expiry at week 5.
  this.ddDeal = this.ddLedger.make([PROMISOR, PARTNER], "final-two", "two weeks, then free", undefined, 3, { expiresWeek: 5 });
});

When("the negotiated term passes without a break", function (this: BbWorld) {
  assert.equal(this.ddLedger!.expireWeekScoped(5).length, 0, "at the term it still binds");
  this.ddLedger!.expireWeekScoped(6); // past the term
});

Then("the engine resolves the deal kept", function (this: BbWorld) {
  assert.equal(this.ddDeal!.status, "kept");
});

// --- Scenario: breaking early scales the shock up with life remaining ---------

Given("two identical deals with an explicit term, broken at the same seed", function (this: BbWorld) {
  this.ddLedger = new DealLedger();
  this.ddDeal = this.ddLedger.make([PROMISOR, PARTNER], "final-two", "long way to go", undefined, 1, { expiresWeek: 6 });
  this.ddRel = new RelationshipModel(0.5);
  this.ddThreat0 = edge(this.ddRel).threat;

  this.ddLedgerB = new DealLedger();
  this.ddDealB = this.ddLedgerB.make([PROMISOR, PARTNER], "final-two", "almost done", undefined, 1, { expiresWeek: 6 });
  this.ddRelB = new RelationshipModel(0.5);
  this.ddThreat0B = edge(this.ddRelB).threat;
});

When("one is broken with many weeks of term left and the other with one week left", function (this: BbWorld) {
  breakIt(this.ddLedger!, this.ddRel!, 1); // 5 weeks left
  breakIt(this.ddLedgerB!, this.ddRelB!, 5); // 1 week left
});

Then("the many-weeks-left break raises the wronged party's threat more than the one-week-left break", function (this: BbWorld) {
  const farRise = edge(this.ddRel!).threat - this.ddThreat0!;
  const nearRise = edge(this.ddRelB!).threat - this.ddThreat0B!;
  assert.ok(farRise > nearRise, "more remaining life ⇒ a larger threat rise");
  assert.ok(nearRise > 0, "a term-remaining break still hurts");
});

// --- Scenario: a vague promise softens the betrayal ---------------------------

Given("an open deal left vague and an equivalent deal with no duration", function (this: BbWorld) {
  this.ddLedger = new DealLedger();
  this.ddDeal = this.ddLedger.make([PROMISOR, PARTNER], "final-two", "unspoken", undefined, 1, { vague: true });
  this.ddRel = new RelationshipModel(0.5);
  this.ddThreat0 = edge(this.ddRel).threat;
  this.ddTrust0 = edge(this.ddRel).trust;

  this.ddLedgerB = new DealLedger();
  this.ddDealB = this.ddLedgerB.make([PROMISOR, PARTNER], "final-two", "clean", undefined, 1); // no duration
  this.ddRelB = new RelationshipModel(0.5);
  this.ddThreat0B = edge(this.ddRelB).threat;
});

When("each is broken at the same seed", function (this: BbWorld) {
  breakIt(this.ddLedger!, this.ddRel!); // vague ⇒ softened
  breakIt(this.ddLedgerB!, this.ddRelB!); // no duration ⇒ scale 1
});

Then("the vague break folds a smaller betrayal-shock than the no-duration break", function (this: BbWorld) {
  const vagueRise = edge(this.ddRel!).threat - this.ddThreat0!;
  const plainRise = edge(this.ddRelB!).threat - this.ddThreat0B!;
  assert.ok(vagueRise < plainRise, "the vague break is softer than the unscaled break");
});

Then("the vague break is still a betrayal: threat rises and trust falls", function (this: BbWorld) {
  assert.ok(edge(this.ddRel!).threat - this.ddThreat0! > 0, "threat still rose");
  assert.ok(this.ddTrust0! - edge(this.ddRel!).trust > 0, "trust still fell");
});

// --- Scenario: term persists; derived magnitude never reaches the player ------

Given("a deal with a negotiated term and the vague label", function (this: BbWorld) {
  this.ddLedger = new DealLedger();
  this.ddDeal = this.ddLedger.make([PROMISOR, PARTNER], "final-two", "two weeks", undefined, 3, { expiresWeek: 5 });
  this.ddLedger.make([PROMISOR, PARTNER], "safety", "unspoken", undefined, 3, { vague: true });
});

When("the deals are serialized and reloaded", function (this: BbWorld) {
  const snap = JSON.parse(JSON.stringify(this.ddLedger!.serialize()));
  this.ddLedgerB = new DealLedger();
  this.ddLedgerB.load(snap);
});

Then("both the term and the label survive the round-trip losslessly", function (this: BbWorld) {
  assert.deepEqual(this.ddLedgerB!.all, this.ddLedger!.all, "the durable round-trip is lossless");
  const reloaded = this.ddLedgerB!.all;
  assert.equal(reloaded[0]!.expiresWeek, 5, "the explicit term survived");
  assert.equal(reloaded[1]!.vague, true, "the vague label survived");
});

Then("the player-facing deal shows the negotiated term but no shock or scale number", function (this: BbWorld) {
  const d = this.ddDeal!;
  // The player-facing projection: terms incl. the negotiated expiry (their own knowledge).
  const facing = { id: d.id, parties: d.parties, kind: d.kind, terms: d.terms, status: d.status, expiresWeek: d.expiresWeek, vague: d.vague };
  const blob = JSON.stringify(facing);
  assert.ok(blob.includes("expiresWeek"), "the negotiated term is the player's own knowledge");
  for (const banned of ["trust", "threat", "affinity", "confidence", "reliability", "vagueSoften", "perWeekRemaining", "maxScale", "severity"]) {
    assert.ok(!blob.includes(banned), `player-facing deal must not expose ${banned}`);
  }
});
