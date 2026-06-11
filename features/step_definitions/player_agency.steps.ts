import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import {
  newLiveSeason, advance, applyDecision,
  type LiveSeasonState, type SeasonCtx, type BeatEvent,
} from "../../src/engine/liveSeason";
import { RelationshipModel } from "../../src/engine/relationships";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

// E34 (0047 amendment) + E37 (0037 amendment) — the player's goodbye message and the
// player-juror's question are REAL pending decisions: the engine never speaks for the player.
// HARD rule: roles only — no names.

const ctxOf = (rel: RelationshipModel): SeasonCtx => ({
  player: PLAYER, statsOf: () => ({ physical: 0.5, mental: 0.5, social: 0.5 }), rel,
});

// --- E34: the player's goodbye message ------------------------------------------

Given("an eviction whose result has landed with the player surviving", function (this: BbWorld) {
  // The player is HOH (survives by construction); four NPC voters send a nominee out 3–1.
  const s = newLiveSeason([PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5), npc(6)]);
  s.beat = "eviction"; s.hoh = PLAYER; s.finalNominees = [npc(1), npc(2)];
  const rel = new RelationshipModel(0.5);
  for (const v of [npc(3), npc(4), npc(5)]) { rel.edge(v, npc(2)).threat = 0.9; rel.edge(v, npc(1)).threat = 0.1; }
  rel.edge(npc(6), npc(1)).threat = 0.9; rel.edge(npc(6), npc(2)).threat = 0.1;
  this.agS = s; this.agCtx = ctxOf(rel); this.agBeats = [];
});

When("the goodbye stage reaches the player", function (this: BbWorld) {
  const s = this.agS!;
  const rng = new SeededRandom(7);
  for (let g = 0; g < 100 && !s.pending; g++) {
    const ev = advance(s, this.agCtx!, rng);
    if (ev) this.agBeats!.push(ev);
  }
});

Then("the loop pauses for the player's goodbye message", function (this: BbWorld) {
  const p = this.agS!.pending;
  assert.ok(p && p.kind === "goodbye-message", "a goodbye-message decision is pending");
  assert.equal(p.by, PLAYER);
  assert.deepEqual((p as { tones: string[] }).tones, ["warm", "respectful", "cold"]);
});

Then("no player goodbye beat exists before the decision is resolved", function (this: BbWorld) {
  for (const b of this.agBeats!.filter((b) => b.beat === "eviction-goodbye")) {
    assert.notEqual(b.participants[0], PLAYER, "the engine never authored a player goodbye");
  }
});

Then("the player's chosen tone folds into the evictee's manner toward the player", function (this: BbWorld) {
  const s = this.agS!;
  const evictee = s.evictionOrder[s.evictionOrder.length - 1]!;
  const ev = applyDecision(s, { kind: "goodbye-message", tone: "cold" }, this.agCtx!);
  assert.equal(ev.beat, "eviction-goodbye");
  assert.equal(ev.participants[0], PLAYER);
  // The fold honors the player's CHOICE (goodbyeMannerFor), exactly as an NPC tone would fold.
  assert.equal(s.mannerByEvictee![evictee]![PLAYER]!.disrespected, true);
});

// --- E37: the player-juror question ----------------------------------------------

Given("a finale where the player sits on the jury", function (this: BbWorld) {
  const A = npc(50), B = npc(51);
  const jury = [PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5), npc(6), npc(7), npc(8)];
  const rel = new RelationshipModel(0.5);
  for (const j of jury) {
    Object.assign(rel.edge(j, A), { trust: 0.5, affinity: 0.5, threat: 0.3 });
    Object.assign(rel.edge(j, B), { trust: 0.5, affinity: 0.5, threat: 0.3 });
  }
  const s: LiveSeasonState = {
    week: 9, beat: "finale", active: [A, B], vetoUsed: false,
    evictionOrder: [...jury], finished: false,
  };
  this.agS = s; this.agCtx = ctxOf(rel); this.agFinalists = [A, B];
});

When("the question round reaches the player's seat", function (this: BbWorld) {
  const s = this.agS!;
  const rng = new SeededRandom(5);
  this.agQuestioned = [];
  // Drive the WHOLE finale, recording each player-juror question pause as it lands.
  for (let g = 0; g < 1000 && !s.finished; g++) {
    if (s.pending?.kind === "juror-question") {
      this.agQuestioned.push(s.pending.finalist);
      applyDecision(s, { kind: "juror-question", question: "what was your game?" }, this.agCtx!);
      continue;
    }
    if (s.pending?.kind === "juror-vote") {
      applyDecision(s, { kind: "juror-vote", vote: s.pending.finalists[0] }, this.agCtx!);
      continue;
    }
    advance(s, this.agCtx!, rng);
  }
});

Then("the loop pauses for the player's juror question to each finalist", function (this: BbWorld) {
  assert.deepEqual([...this.agQuestioned!].sort(), [...this.agFinalists!].sort(),
    "the player-juror questioned BOTH finalists themselves");
});

Then("the juror question is scoreless", function (this: BbWorld) {
  // Same fixture, same seed, radically different question text ⇒ identical winner and reveals.
  const run = (question: string): string => {
    const A = npc(50), B = npc(51);
    const jury = [PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5), npc(6), npc(7), npc(8)];
    const rel = new RelationshipModel(0.5);
    for (const j of jury) {
      Object.assign(rel.edge(j, A), { trust: 0.5, affinity: 0.5, threat: 0.3 });
      Object.assign(rel.edge(j, B), { trust: 0.5, affinity: 0.5, threat: 0.3 });
    }
    const s: LiveSeasonState = {
      week: 9, beat: "finale", active: [A, B], vetoUsed: false,
      evictionOrder: [...jury], finished: false,
    };
    const ctx = ctxOf(rel);
    const rng = new SeededRandom(42);
    const reveals: string[] = [];
    for (let g = 0; g < 1000 && !s.finished; g++) {
      if (s.pending?.kind === "juror-question") { applyDecision(s, { kind: "juror-question", question }, ctx); continue; }
      if (s.pending?.kind === "juror-vote") { applyDecision(s, { kind: "juror-vote", vote: s.pending.finalists[1] }, ctx); continue; }
      const ev: BeatEvent | null = advance(s, ctx, rng);
      if (ev?.beat === "finale-reveal") reveals.push(`${ev.participants[0]}->${ev.participants[1]}`);
    }
    return `${s.winner}|${reveals.join(",")}`;
  };
  assert.equal(run("a long, pointed, devastating question"), run("x"),
    "the question text sways nothing — scoreless by construction");
});

Then("the finalist's answer remains engine-chosen", function (this: BbWorld) {
  const s = this.agS!;
  // Both finalists' answers to the player-juror were recorded by the ENGINE for the tally.
  for (const fin of this.agFinalists!) {
    assert.ok(s.finale!.appeals[fin]?.[PLAYER], "the engine recorded the finalist's answer to the player");
  }
});
