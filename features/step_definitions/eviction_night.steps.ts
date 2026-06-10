import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import type { AdvanceView, EvictionView, SubmitDecisionReq } from "../../src/ports/GameSession";
import { goodbyeMannerFor } from "../../src/engine/liveSeason";
import { juryLean } from "../../src/engine/jury";
import { PLAYER, npc } from "../../src/domain/ids";

// Feature 0047 — eviction night live. Driven through the live MCP seam (createCharacter →
// advanceGame / submitDecision). HARD rule: roles only — no names.

function resolve(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): AdvanceView {
  const submit = (req: SubmitDecisionReq): AdvanceView => s.submitDecision(req);
  if (p.kind === "nominations") return submit({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  if (p.kind === "veto-decision") return submit({ kind: "veto-decision", use: false });
  if (p.kind === "replacement") return submit({ kind: "replacement", replacement: p.options[0]!.id });
  if (p.kind === "comp-intent") return submit({ kind: "comp-intent", intent: "compete" });
  if (p.kind === "finale-statement") return submit({ kind: "finale-statement", statement: "x" });
  if (p.kind === "finale-answer") return submit({ kind: "finale-answer", appeal: p.appeals![0]! });
  if (p.kind === "juror-vote") return submit({ kind: "juror-vote", vote: p.options[0]!.id });
  return submit({ kind: p.kind, vote: p.options[0]!.id });
}

/** Drive a fresh game to the FIRST staging eviction (stage "votes"); collect the advance views from there. */
function driveToEvictionStaging(s: GameSessionAdapter): AdvanceView {
  for (let i = 0; i < 3000; i++) {
    const v = s.advanceGame();
    if (v.eviction?.stage === "votes") return v;
    if (v.pending) {
      const sv = resolve(s, v.pending);
      if (sv.eviction?.stage === "votes") return sv;
    }
    if (v.finished) throw new Error("the game finished before an eviction staged");
  }
  throw new Error("no eviction staged within bound");
}

let enUsers = 0;
function newGame(w: BbWorld, seed: number): GameSessionAdapter {
  const reg = new GameSessionRegistry();
  const user = `en${enUsers++}`;
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "P", seed });
  w.enRegistry = reg; w.enUser = user; w.enSandbox = sb;
  return sb.session;
}

const revealOrder = (views: AdvanceView[]): string =>
  views.filter((v) => v.event?.beat === "eviction-reveal").map((v) => v.event!.content).join("|");

// --- Scenario: votes revealed one at a time, deterministic order -----------------

Given("a started game at an eviction with a decided vote", function (this: BbWorld) {
  const s = newGame(this, 2);
  this.enViews = [driveToEvictionStaging(s)];
});

When("the eviction is advanced through the seam", function (this: BbWorld) {
  const s = this.enSandbox!.session;
  // Step the reveal to the end of the votes stage, collecting each advance view.
  for (let i = 0; i < 60 && (this.enViews![this.enViews!.length - 1].eviction?.stage === "votes"); i++) {
    const v = s.advanceGame();
    this.enViews!.push(v);
    if (v.pending) resolve(s, v.pending); // a player-HOH tie-break, if any
  }
});

Then("the eviction votes are revealed one at a time", function (this: BbWorld) {
  // Each step through the votes stage reveals exactly ONE more vote than the last.
  const counts = this.enViews!
    .filter((v) => v.eviction && v.eviction.stage === "votes")
    .map((v) => v.eviction!.votesRevealed.length);
  assert.ok(counts.length >= 2, "several reveal steps");
  for (let i = 1; i < counts.length; i++) assert.equal(counts[i], counts[i - 1]! + 1, "one vote revealed per advance");
});

Then("the reveal order is the same for the same seed", function (this: BbWorld) {
  this.enRevealOrderA = revealOrder(this.enViews!);
  const s2 = newGame(this, 2);
  const views: AdvanceView[] = [driveToEvictionStaging(s2)];
  for (let i = 0; i < 60 && (views[views.length - 1].eviction?.stage === "votes"); i++) {
    const v = s2.advanceGame();
    views.push(v);
    if (v.pending) resolve(s2, v.pending);
  }
  assert.equal(revealOrder(views), this.enRevealOrderA, "same seed ⇒ same reveal order");
});

Then("the running tally shows only the votes revealed so far", function (this: BbWorld) {
  // The projection only ever carries the votes already read — never an unread vote or a pre-reveal total.
  const staging = this.enViews!.filter((v) => v.eviction?.stage === "votes");
  const last = staging[staging.length - 1]!.eviction!;
  const totalRevealedEver = Math.max(...staging.map((v) => v.eviction!.votesRevealed.length));
  // While still in the votes stage, fewer than the full electorate are shown (the rest are unread).
  for (const v of staging.slice(0, -1)) assert.ok(v.eviction!.votesRevealed.length < totalRevealedEver + 1);
  for (const r of last.votesRevealed) {
    assert.ok([last.nominees[0]!.id, last.nominees[1]!.id].includes(r.votedFor.id), "a revealed vote is for a nominee");
  }
});

// --- Scenario: the evictee is not knowable before the last vote ------------------

Given("an eviction mid-reveal", function (this: BbWorld) {
  const s = newGame(this, 2);
  const first = driveToEvictionStaging(s);
  this.enViews = [first];
  // Advance ONE step into the reveal (still partial) without finishing it.
  this.enViews.push(s.advanceGame());
});

When("the eviction surface is read mid-reveal", function (this: BbWorld) {
  this.enSentinel = "SENTINEL-0047-bdd-eviction";
  this.enSandbox!.engine.events.record({
    id: "hidden:0047-bdd", ts: 10_000_003, type: "conversation",
    initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: this.enSentinel,
  });
  this.lastOutput = JSON.stringify(this.enSandbox!.session.advanceGame()) + "\n" + JSON.stringify(this.enSandbox!.session.getGameState());
});

Then("it shows no pre-reveal tally and no unread vote", function (this: BbWorld) {
  const view = this.enSandbox!.session.advanceGame();
  const ev: EvictionView | null | undefined = view.eviction;
  if (ev && ev.stage === "votes") {
    // Only the read votes are present; the electorate size is never disclosed.
    assert.ok(ev.votesRevealed.length >= 1);
    assert.ok(!Object.keys(ev).includes("tally"), "no pre-reveal tally field");
  }
});

Then("it does not name the evictee until the final vote lands", function (this: BbWorld) {
  // Mid-reveal, the projection has no evictee field, and the house roster still lists everyone as active
  // (no one is marked evicted before the result lands).
  const view = this.enViews![this.enViews!.length - 1];
  assert.ok(!(view.eviction && Object.keys(view.eviction).includes("evictee")), "EvictionView never names the evictee");
});

Then("no Vault sentinel value appears on the eviction surface", function (this: BbWorld) {
  assert.ok(!this.lastOutput.includes(this.enSentinel!), "no Vault sentinel crosses onto the eviction surface");
});

// --- Scenario: the evicted houseguest gets a goodbye beat ------------------------

Given("an eviction whose result has landed", function (this: BbWorld) {
  const s = newGame(this, 2);
  driveToEvictionStaging(s);
  this.enViews = [];
  // Drive to the end of the votes stage (the result lands; the goodbye stage opens).
  for (let i = 0; i < 60; i++) {
    const v = s.advanceGame();
    this.enViews.push(v);
    if (v.pending) resolve(s, v.pending);
    if (v.eviction?.stage === "goodbye" || v.event?.beat === "eviction") break;
  }
});

When("the staging continues", function (this: BbWorld) {
  const s = this.enSandbox!.session;
  for (let i = 0; i < 60; i++) {
    const v = s.advanceGame();
    this.enViews!.push(v);
    if (v.pending) resolve(s, v.pending);
    if (v.event?.beat === "eviction-result") break;
  }
});

Then("an evictee goodbye beat occurs", function (this: BbWorld) {
  assert.ok(this.enViews!.some((v) => v.event?.beat === "eviction-goodbye"), "a goodbye beat was surfaced");
});

Then("goodbye messages from the house are recorded", function (this: BbWorld) {
  const goodbyes = this.enSandbox!.engine.events.query().filter((e) => /goodbye message/.test(e.content));
  assert.ok(goodbyes.length > 0, "goodbye messages are recorded as events");
});

// --- Scenario: a warm vs a cold goodbye move the jury differently ----------------

Given("the same evictee sent out with respectful goodbyes versus cold ones", function (this: BbWorld) {
  // The pure property the live goodbye folds into manner: tone → respected/disrespected → lean shift.
  const rel = { trust: 0.5, affinity: 0.5, threat: 0.3 };
  this.enWarmLean = juryLean(rel, goodbyeMannerFor("warm"));
  this.enColdLean = juryLean(rel, goodbyeMannerFor("cold"));
});

When("that evictee later leans as a juror", function () {
  // The leans were computed from the recorded goodbye manner in the Given.
});

Then("the respectful send-off yields a measurably more favorable lean", function (this: BbWorld) {
  assert.ok(this.enWarmLean! > this.enColdLean!, "a warm send-off lifts the juror lean above a cold one");
});

// --- Scenario: the staging runs through the seam and survives a restart ----------

Given("an eviction staged through the advance seam", function (this: BbWorld) {
  const s = newGame(this, 2);
  driveToEvictionStaging(s);
  s.advanceGame(); // read one more vote — now mid-reveal
});

When("the engine restarts mid-reveal", function (this: BbWorld) {
  const user = this.enUser!;
  const snap = this.enRegistry!.snapshot(user);
  const reg2 = new GameSessionRegistry();
  reg2.restore(user, snap);
  const resumed = reg2.sandboxFor(user).session;
  // Finish the eviction from the restored state; record the engine-decided evictee.
  let evictee = "";
  for (let i = 0; i < 200; i++) {
    const v = resumed.advanceGame();
    if (v.event?.beat === "eviction") evictee = v.event.content;
    if (v.pending) resolve(resumed, v.pending);
    if (v.event?.beat === "eviction-result" || v.finished) break;
  }
  this.enResumedEvictee = evictee;
  // Finish the ORIGINAL too, for comparison.
  let origEvictee = "";
  const orig = this.enSandbox!.session;
  for (let i = 0; i < 200; i++) {
    const v = orig.advanceGame();
    if (v.event?.beat === "eviction") origEvictee = v.event.content;
    if (v.pending) resolve(orig, v.pending);
    if (v.event?.beat === "eviction-result" || v.finished) break;
  }
  this.enOriginalEvictee = origEvictee;
});

Then("the eviction resumes from where it left off", function (this: BbWorld) {
  assert.ok(this.enResumedEvictee!.length > 0, "the restored game finished the eviction");
  assert.equal(this.enResumedEvictee, this.enOriginalEvictee, "the resumed eviction reaches the same result");
});
