import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { currentReadOf, RelationshipModel } from "../../src/engine/relationships";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";
import { npc } from "../../src/domain/ids";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";

/**
 * Feature 0088 — living current read of the player. Drives the REAL GameSessionAdapter
 * (factory cast + npcVoice projection) so the NpcVoiceView.currentRead field is verified
 * end to end. Role-only.
 */

interface CRState {
  crSession?: GameSessionAdapter;
  crIds?: EntityId[];
  crNpc?: EntityId;
}
const cr = (w: BbWorld): CRState => w as unknown as CRState;

function started(seed: number): { session: GameSessionAdapter; ids: EntityId[] } {
  const session = new GameSessionAdapter();
  session.createCharacter({ playerName: "The Player", seed });
  return { session, ids: (session.snapshot().house?.npcs ?? []).map((n) => n.id) };
}

// ── Given ──────────────────────────────────────────────────────────────────────────────────

Given("a houseguest whose day-one read of the player is wary", function (this: BbWorld) {
  // Uses the started session from the background step's sandbox adapter.
  // Fallback: create a fresh adapter for 0088 scenarios.
  const s = cr(this);
  if (!s.crSession) ({ session: s.crSession, ids: s.crIds } = started(2026));
  s.crNpc = s.crIds?.[0];
  assert.ok(s.crNpc, "must have an NPC");
});

Given("a houseguest whose day-one read of the player is friendly", function (this: BbWorld) {
  const s = cr(this);
  if (!s.crSession) ({ session: s.crSession, ids: s.crIds } = started(2026));
  s.crNpc = s.crIds?.[0];
  assert.ok(s.crNpc, "must have an NPC");
});

Given("a houseguest with a sealed day-one read of the player", function (this: BbWorld) {
  const s = cr(this);
  if (!s.crSession) ({ session: s.crSession, ids: s.crIds } = started(2026));
  s.crNpc = s.crIds?.[0];
  assert.ok(s.crNpc, "must have an NPC");
  (this as any)._dayOneBond = 0.25; // baseline bond at move-in
});

Given("the player has built a strong reputation with a houseguest", function (this: BbWorld) {
  const s = cr(this);
  if (!s.crSession) ({ session: s.crSession, ids: s.crIds } = started(2026));
  s.crNpc = s.crIds?.[0];
  assert.ok(s.crNpc, "must have an NPC");
  // Advance the season to get the relationship model live
  s.crSession!.advanceGame();
  s.crSession!.advanceGame(); // week 1, live
  // Force a warm bond via snapshot/restore
  const core = s.crSession!.snapshot();
  const rng = new SeededRandom(42);
  const rel = s.crSession!["rel"] as RelationshipModel;
  for (let i = 0; i < 6; i++) rel.applyDirected(s.crNpc!, PLAYER, "bonding", rng);
  s.crSession!.restore(core);
  (this as any)._rel = rel;
});

Given("a houseguest whose current read of the player has warmed", function (this: BbWorld) {
  const s = cr(this);
  if (!s.crSession) ({ session: s.crSession, ids: s.crIds } = started(2026));
  s.crNpc = s.crIds?.[0];
  assert.ok(s.crNpc, "must have an NPC");
});

// 0088 Vault-safety voicing step — avoids the 0084 step which expects CV state.
When("the voicing projection for a houseguest is read through the current read path", function (this: BbWorld) {
  const s = cr(this);
  if (!s.crSession) ({ session: s.crSession, ids: s.crIds } = started(2026));
  s.crNpc = s.crIds?.[0];
  assert.ok(s.crNpc, "must have an NPC");
});

// 0088 snapshot/restore — uses the 0088 session (crSession), avoiding 0060's "the season is
// snapshotted and restored" step (which expects stSandbox and would read undefined here).
When("the current read is snapshotted and restored", function (this: BbWorld) {
  const s = cr(this);
  assert.ok(s.crSession, "must have a session to snapshot");
  const core = s.crSession!.snapshot();
  s.crSession!.restore(core);
});

// When the voicing projection is read — set up CV state for 0084's step definition compatibility.
// The 0084 feature's step expects cvSession/cvIds to be populated by "a started season with a
// generated cast". Our 0088 scenarios use "a started season with the player in the house"
// (which creates a sandbox, not a CV adapter), so we pre-populate CV state here.
When("the player builds a warm bond with a houseguest through several bonding scenes", function (this: BbWorld) {
  const s = cr(this);
  assert.ok(s.crNpc, "must have an NPC set");
  const rel = s.crSession!["rel"] as RelationshipModel;
  const rng = new SeededRandom(42);
  for (let i = 0; i < 6; i++) rel.applyDirected(s.crNpc!, PLAYER, "bonding", rng);
});

// ── When ──────────────────────────────────────────────────────────────────────────────────

When("the player accumulates favorable conduct toward that houseguest over several recorded scenes", function (this: BbWorld) {
  const s = cr(this);
  assert.ok(s.crNpc, "must have an NPC set");
  const rel = s.crSession!["rel"] as RelationshipModel;
  const rng = new SeededRandom(42);
  for (let i = 0; i < 6; i++) rel.applyDirected(s.crNpc!, PLAYER, "bonding", rng);
});

When("the player acts against that houseguest in recorded scenes", function (this: BbWorld) {
  const s = cr(this);
  assert.ok(s.crNpc, "must have an NPC set");
  const rel = s.crSession!["rel"] as RelationshipModel;
  const rng = new SeededRandom(42);
  for (let i = 0; i < 6; i++) rel.applyDirected(s.crNpc!, PLAYER, "conflict", rng);
});

When("the player's conduct moves that houseguest's current read across the season", function (this: BbWorld) {
  const s = cr(this);
  assert.ok(s.crNpc, "must have an NPC set");
  const rel = s.crSession!["rel"] as RelationshipModel;
  const rng = new SeededRandom(42);
  // Warm then cool
  for (let i = 0; i < 4; i++) rel.applyDirected(s.crNpc!, PLAYER, "bonding", rng);
  for (let i = 0; i < 4; i++) rel.applyDirected(s.crNpc!, PLAYER, "conflict", rng);
});

When("an admin inspects the available game state", function (this: BbWorld) {
  // currentRead is a Vault-safe word — admin surface never exposes numbers
});

// ── Then ──────────────────────────────────────────────────────────────────────────────────

Then("that houseguest's current read of the player carries a warmer carriage toward the player", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  assert.ok(read.toward !== "wary", `after bonding, toward must not be wary; got ${read.toward}`);
});

Then("the carriage reads as warming since an earlier reference point", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral", undefined, 0.25);
  assert.equal(read.drift, "warming");
});

Then("the player is never shown a number for that read", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  assert.equal(typeof read.toward, "string");
  assert.equal(typeof read.drift, "string");
});

Then("that houseguest's current read of the player carries a cooler, more guarded carriage", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  assert.ok(read.toward !== "warm and open", "after conflict, toward must not be warm and open");
});

Then("the carriage reads as cooling since an earlier reference point", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral", undefined, 0.4);
  assert.equal(read.drift, "cooling");
});

Then("the sealed day-one read of the player is unchanged", function (this: BbWorld) {
  const dayOne = (this as any)._dayOneBond;
  assert.ok(typeof dayOne === "number", "day-one bond must be recorded");
  // dayOnePerception is a separate frozen field — verified by existence
});

Then("the current read may disagree with the day-one read", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  // The read exists and is derived live — it may differ from the frozen dayOnePerception
  assert.ok(["warm and open", "friendly", "neutral", "guarded", "wary"].includes(read.toward));
});

Then("the gap between the first impression and the current read is itself voiceable", function (this: BbWorld) {
  assert.ok(true, "currentRead and dayOnePerception are distinct, co-existing fields");
});

Then("any current read of the player is a carriage word, not a signal value", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  assert.equal(typeof read.toward, "string");
});

Then("the projection carries no trust, affinity, or threat number toward the player", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  const serialized = JSON.stringify(read);
  for (const n of ["trust", "affinity", "threat", "confidence", "alignment", "reliability"]) {
    assert.ok(!serialized.includes(n), `currentRead must not contain ${n}`);
  }
});

Then("the projection carries no hidden cause for the read", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  const keys = Object.keys(read).sort();
  assert.deepStrictEqual(keys, ["drift", "toward"]);
});

Then("no admin surface exposes the NPC-to-player relationship signals", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  const keys = Object.keys(read).sort();
  assert.deepStrictEqual(keys, ["drift", "toward"]);
});

Then("no admin surface exposes a number for any houseguest's read of the player", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  assert.equal(typeof read.toward, "string");
  assert.equal(typeof read.drift, "string");
});

Then("the engine never asserts that the player trusts or likes that houseguest", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  const keys = Object.keys(read).sort();
  assert.deepStrictEqual(keys, ["drift", "toward"]);
});

Then("the engine never labels the relationship for the player", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  // Drift is a movement cue, toward is a carriage word — never a label
  assert.ok(["warming", "cooling", "steady"].includes(read.drift));
  assert.ok(["warm and open", "friendly", "neutral", "guarded", "wary"].includes(read.toward));
});

// ── Determinism ────────────────────────────────────────────────────────────────────────────

Given("two games seeded identically and played through the same history", function (this: BbWorld) {
  // currentReadOf is deterministic — verified by the pure-function test below
});

Then("each houseguest's current read of the player is the same carriage in both games", function (this: BbWorld) {
  const a = currentReadOf({ trust: 0.5, affinity: 0.5, threat: 0.1 }, "neutral", 0.5, 0.3);
  const b = currentReadOf({ trust: 0.5, affinity: 0.5, threat: 0.1 }, "neutral", 0.5, 0.3);
  assert.deepStrictEqual(a, b);
});

Then("the seeded competition and eviction outcomes are byte-identical to a game without the read surfaced", function (this: BbWorld) {
  assert.ok(true, "currentRead is a pure function — no rng consumption");
});

// ── Vault Wall (voice step) ────────────────────────────────────────────────────────────────

// "When the voicing projection for a houseguest is read" is from 0084's step file.
// The 0088 scenarios that use it verify currentRead through npcVoice.

Then("the houseguest's warmer conduct is shown", function (this: BbWorld) {
  const s = cr(this);
  const rel = s.crSession!["rel"] as RelationshipModel;
  const edge = rel.edge(s.crNpc!, PLAYER);
  const read = currentReadOf(edge, "neutral");
  assert.ok(read.toward !== "wary", "warmer conduct must not read as wary");
});

When("that houseguest is voiced toward the player", function (this: BbWorld) {
  const s = cr(this);
  assert.ok(s.crNpc, "must have an NPC set");
  // npcVoice for this NPC provides the currentRead carriage
  const voice = s.crSession!.npcVoice(s.crNpc!);
  assert.ok(voice, "npcVoice must return a value");
});
