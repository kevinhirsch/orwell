import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import {
  ARCHETYPES, ALL_STRATEGY_STYLES, playerAptitudesWithinNpcBounds,
} from "../../src/engine/characterFactory";
import { cloneSession } from "../../src/engine/sessionSnapshot";

// Feature 0050 — the casting interview. Roles only; the canonical mapping is taken from the
// engine's own ARCHETYPES table (never hand-typed) so these steps can't drift from the casting sheet.

const CANONICAL = ARCHETYPES[1]!; // any canonical row works; the steps assert behavior, not identity
const INTERVIEW_REQ = {
  playerName: "The Interviewee",
  archetype: CANONICAL.archetype,
  strategyStyle: CANONICAL.styles[0]!,
  personaArchetype: "the quiet schemer next door",
  personaStrategyStyle: "smile first, strike later",
  backstory: "ran a small diner and studied every season of the show twice",
  motivation: "to prove the quiet one can win the whole thing",
  privateStrategy: "hide my real read on people until the jury forms",
  interviewNotes: ["youngest of five, used to being underestimated", "hates losing at cards"],
};
const TIER_WORDS = new Set(["standout", "solid", "scrappy"]);

// --- The pre-game moment is the producer's interview ---------------------------

Given("no game has started", function (this: BbWorld) {
  this.castSession = new GameSessionAdapter();
});

When("the moment prompt is requested", function (this: BbWorld) {
  this.castPrompt = this.castSession!.getMomentPrompt({}).systemPrompt;
});

Then("the prompt frames the producer conducting a casting interview", function (this: BbWorld) {
  assert.match(this.castPrompt!, /producer/i);
  assert.match(this.castPrompt!, /casting interview/i);
});

Then("the prompt instructs the model to end the interview through character creation", function (this: BbWorld) {
  assert.match(this.castPrompt!, /createCharacter/);
});

Then("the prompt carries every canonical archetype in its manifest", function (this: BbWorld) {
  for (const spec of ARCHETYPES) assert.ok(this.castPrompt!.includes(spec.archetype), spec.archetype);
});

Then("the prompt carries every canonical strategy style in its manifest", function (this: BbWorld) {
  for (const style of ALL_STRATEGY_STYLES) assert.ok(this.castPrompt!.includes(style), style);
});

// --- Distillation: canonical mapping + the player's own words ------------------

When("character creation is submitted with a canonical mapping and the player's own words", function (this: BbWorld) {
  this.castSession = new GameSessionAdapter();
  this.castView = this.castSession.createCharacter({ ...INTERVIEW_REQ, seed: 11 });
});

Then("the player's card voices the player's own words", function (this: BbWorld) {
  assert.equal(this.castView!.player!.archetype, INTERVIEW_REQ.personaArchetype);
  assert.equal(this.castView!.player!.strategyStyle, INTERVIEW_REQ.personaStrategyStyle);
});

Then("the canonical archetype drives aptitudes within the generated houseguests' bounds", function (this: BbWorld) {
  const player = this.castSession!.snapshot().house!.player;
  assert.equal(player.character.archetype, CANONICAL.archetype);
  assert.ok(playerAptitudesWithinNpcBounds(player));
});

// --- The casting card: words cross the wall, numbers never do ------------------

When("character creation is submitted with interview material", function (this: BbWorld) {
  this.castSession = new GameSessionAdapter();
  this.castView = this.castSession.createCharacter({ ...INTERVIEW_REQ, seed: 11 });
});

Then("the creation result carries a casting card", function (this: BbWorld) {
  assert.ok(this.castView!.player!.castingCard);
});

Then("the casting card names a character type and a strategy style", function (this: BbWorld) {
  const card = this.castView!.player!.castingCard!;
  assert.equal(card.characterType, CANONICAL.archetype);
  assert.ok(card.strategyStyle.length > 0);
});

Then("the casting card reads each strength as a tier word", function (this: BbWorld) {
  const { physical, mental, social } = this.castView!.player!.castingCard!.strengths;
  for (const tier of [physical, mental, social]) assert.ok(TIER_WORDS.has(tier), tier);
});

Then("no numeric aptitude appears anywhere in the player-facing payload", function (this: BbWorld) {
  const json = JSON.stringify(this.castView);
  assert.ok(!json.includes('"stats"'));
  // The balanced aptitudes are the only fractional values the player object could carry; the
  // public projection holds none (week/ids are integers, strengths are words).
  assert.doesNotMatch(json, /\d\.\d/);
});

// --- Seeding the datastore ------------------------------------------------------

Then("the player's static Character carries the authored backstory", function (this: BbWorld) {
  assert.equal(this.castSession!.snapshot().house!.player.character.background, INTERVIEW_REQ.backstory);
});

Then("the player's Soul memory carries the interview material", function (this: BbWorld) {
  const memory = this.castSession!.snapshot().house!.player.soul.memory;
  assert.ok(memory.some((m) => m.includes(INTERVIEW_REQ.motivation)));
  for (const note of INTERVIEW_REQ.interviewNotes) {
    assert.ok(memory.some((m) => m.includes(note)), note);
  }
});

Then("the player's private strategy is held as player-only material", function (this: BbWorld) {
  // Held engine-side on the player's authored profile…
  assert.equal(this.castSession!.snapshot().house!.player.privateStrategy, INTERVIEW_REQ.privateStrategy);
  // …and not echoed back through the public projection (the card replays story/motivation only).
  assert.ok(!JSON.stringify(this.castView).includes(INTERVIEW_REQ.privateStrategy));
});

// --- Restart non-degradation ----------------------------------------------------

When("the game is snapshotted and restored", function (this: BbWorld) {
  const snap = cloneSession(this.castSession!.snapshot());
  const resumed = new GameSessionAdapter();
  resumed.restore(snap);
  this.castRestoredPlayer = resumed.snapshot().house!.player;
});

Then("the restored player retains the backstory, motivation, and interview memories", function (this: BbWorld) {
  const p = this.castRestoredPlayer!;
  assert.equal(p.character.background, INTERVIEW_REQ.backstory);
  assert.equal(p.motivation, INTERVIEW_REQ.motivation);
  assert.ok(p.soul.memory.some((m) => m.includes(INTERVIEW_REQ.motivation)));
  for (const note of INTERVIEW_REQ.interviewNotes) {
    assert.ok(p.soul.memory.some((m) => m.includes(note)), note);
  }
});

// --- The OOC wall ---------------------------------------------------------------
// ("character creation produces no witnessed event" reuses the 0015 step definition.)

Then("no houseguest's knowledge at the start of the game holds any interview material", function (this: BbWorld) {
  const interviewStrings = [
    INTERVIEW_REQ.backstory, INTERVIEW_REQ.motivation, INTERVIEW_REQ.privateStrategy,
    ...INTERVIEW_REQ.interviewNotes,
  ];
  for (const n of this.castSession!.snapshot().house!.npcs) {
    const npcJson = JSON.stringify(n);
    for (const s of interviewStrings) assert.ok(!npcJson.includes(s));
  }
});

// --- The no-wipe guard stays intact (B36) ----------------------------------------

When("a second interview-shaped creation is submitted", function (this: BbWorld) {
  this.castView = this.castSession!.createCharacter({
    ...INTERVIEW_REQ, playerName: "The Replacement", seed: 99,
  });
});

Then("the running game is unchanged", function (this: BbWorld) {
  assert.equal(this.castView!.player!.name, INTERVIEW_REQ.playerName);
});
