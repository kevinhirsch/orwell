import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { tallyJury, chooseNominations } from "../../src/engine/season";
import type { SeasonHouseguest, Stats } from "../../src/engine/season";
import { playSeason } from "../../src/engine/calibration";
import {
  newLiveSeason, advance, applyDecision, autoDecision,
  type SeasonCtx,
} from "../../src/engine/liveSeason";
import { selectableReplacements, evictionVoters } from "../../src/domain/eligibility";
import type { WeekState } from "../../src/domain/eligibility";
import { RelationshipModel } from "../../src/engine/relationships";
import { generateHouse } from "../../src/engine/characterFactory";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

function build16(seed: number): SeasonHouseguest[] {
  const { npcs } = generateHouse(new SeededRandom(seed));
  return [
    { id: PLAYER, stats: { physical: 0.5, mental: 0.5, social: 0.5 } },
    ...npcs.map((n) => ({ id: n.id, stats: n.character.stats })),
  ];
}

function week16(over: Partial<WeekState>): WeekState {
  return {
    houseguests: [PLAYER, ...Array.from({ length: 15 }, (_, i) => npc(i + 1))],
    player: PLAYER, hoh: npc(1), nominees: [npc(2), npc(3)], ...over,
  };
}

// --- Full season --------------------------------------------------------------

Given("a new game of sixteen houseguests with a fixed seed", function (this: BbWorld) {
  this.roster = build16(1);
});

When("the season is played to completion", function (this: BbWorld) {
  this.outcome = playSeason({ seed: 1, houseguests: this.roster! });
  this.outcome2 = playSeason({ seed: 1, houseguests: this.roster! });
});

Then("it ends at a Final 2 followed by a jury vote", function (this: BbWorld) {
  assert.equal(this.outcome!.finalTwo.length, 2);
  assert.equal(this.outcome!.jury.length, 9);
});

Then("exactly one houseguest is declared the winner", function (this: BbWorld) {
  assert.ok(this.outcome!.finalTwo.includes(this.outcome!.winner));
});

Then("replaying with the same seed yields the identical season", function (this: BbWorld) {
  assert.deepEqual(this.outcome, this.outcome2);
});

// --- Canonical phase order ----------------------------------------------------
// NOTE: "a week begins with an HOH competition" is defined in daily_event.steps.ts (0008);
// these Then steps are self-contained and don't depend on its side effects.

/** A LIVE-loop ctx over a flat-stat house with seeded edges (NPC decisions differentiated). */
function liveCtx(seed: number): { ctx: SeasonCtx; rng: SeededRandom; ids: string[] } {
  const ids = [PLAYER, ...Array.from({ length: 15 }, (_, i) => npc(i + 1))];
  const rng = new SeededRandom(seed);
  const rel = new RelationshipModel(0.5);
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    const e = rel.edge(a, b);
    e.trust = rng.next(); e.affinity = rng.next(); e.threat = rng.next();
  }
  const stats: Stats = { physical: 0.5, mental: 0.5, social: 0.5 };
  return { ctx: { player: PLAYER, statsOf: () => stats, rel }, rng, ids };
}

Then(
  "it proceeds nominations, veto competition, veto ceremony, eviction vote, live eviction",
  function () {
    // B55: drive ONE week of the LIVE loop (the same `advance` the game runs, pendings answered
    // by the loop's own NPC policy) and assert the canonical order from the OBSERVED beats —
    // never from a parallel constant that can drift from the real machine.
    const { ctx, rng } = liveCtx(11);
    const s = newLiveSeason([...liveCtx(11).ids]);
    const beats: string[] = [];
    for (let i = 0; i < 120 && beats[beats.length - 1] !== "eviction-result"; i++) {
      const ev = s.pending ? applyDecision(s, autoDecision(s, ctx, rng), ctx, rng) : advance(s, ctx, rng);
      if (ev) beats.push(ev.beat);
    }
    const order = ["hoh-competition", "nominations", "veto-competition", "veto-ceremony", "eviction-reveal", "eviction", "eviction-result"];
    const firstIx = order.map((b) => beats.indexOf(b));
    for (let i = 0; i < order.length; i++) assert.ok(firstIx[i]! >= 0, `${order[i]} occurred (saw: ${beats.join(",")})`);
    for (let i = 1; i < order.length; i++) assert.ok(firstIx[i]! > firstIx[i - 1]!, `${order[i]} strictly after ${order[i - 1]}`);
  },
);

Then("a phase begins only after its predecessor has produced a result", function (this: BbWorld) {
  const w = playSeason({ seed: 2, houseguests: build16(2) }).weeks[0]!;
  assert.ok(w.hoh, "HOH produced");
  assert.equal(w.nominees.length, 2, "nominations produced");
  assert.ok(w.vetoHolder, "veto winner produced");
  assert.equal(w.finalNominees.length, 2, "veto ceremony produced final nominees");
  assert.ok(w.evictee, "eviction produced an evictee");
});

// --- Per-week legality (reuses 0005's "the HOH votes only to break a tie") -----

Given("an HOH, two nominees, and a veto holder for the week", function (this: BbWorld) {
  this.week = week16({ hoh: npc(1), nominees: [npc(2), npc(3)], vetoWinner: npc(4) });
});

When("the veto is used and the HOH names a replacement", function (this: BbWorld) {
  const saved = npc(2);
  const selectable = selectableReplacements(this.week!);
  this.chosenReplacement = selectable.find((h) => h !== saved)!;
  const finalNominees: [string, string] = [npc(3), this.chosenReplacement];
  this.week = { ...this.week!, nominees: finalNominees };
  this.voters = evictionVoters(this.week);
});

Then("the replacement is not the veto winner", function (this: BbWorld) {
  assert.notEqual(this.chosenReplacement, this.week!.vetoWinner);
});

Then("at eviction everyone except the HOH and the two nominees votes", function (this: BbWorld) {
  const excluded = new Set([this.week!.hoh, this.week!.nominees[0], this.week!.nominees[1]]);
  const expected = this.week!.houseguests.filter((h) => !excluded.has(h));
  assert.deepEqual([...this.voters!].sort(), [...expected].sort());
});

// --- Jury composition ---------------------------------------------------------

When("the season reaches Final 2", function (this: BbWorld) {
  this.outcome = playSeason({ seed: 3, houseguests: build16(3) });
});

Then("the jury is composed of the last nine evicted houseguests", function (this: BbWorld) {
  assert.deepEqual(this.outcome!.jury, this.outcome!.evictionOrder.slice(-9));
});

Then("the earlier evictees are pre-jury", function (this: BbWorld) {
  assert.deepEqual(this.outcome!.preJury, this.outcome!.evictionOrder.slice(0, -9));
  assert.equal(this.outcome!.preJury.length, 5);
});

// --- Endgame jury vote --------------------------------------------------------

Given("a Final 2 and a jury", function (this: BbWorld) {
  this.outcome = playSeason({ seed: 4, houseguests: build16(4) });
});

When("the jury votes", function (this: BbWorld) {
  assert.ok(this.outcome);
});

Then("the finalist with the most votes wins", function (this: BbWorld) {
  // 0037 reuses this phrase for the LIVE finale tally; assert the live winner when present.
  if (this.lastAdvance) {
    assert.ok(this.lastAdvance.finished && this.lastAdvance.winner, "the live jury tallied a winner");
    return;
  }
  assert.ok(this.outcome!.finalTwo.includes(this.outcome!.winner));
  const a = npc(10);
  const b = npc(11);
  assert.equal(tallyJury([npc(1), npc(2), npc(3)], [a, b], (j) => (j === npc(3) ? b : a), [npc(1), npc(2), npc(3)]), a);
});

Then("a tied jury vote is broken by the last-evicted juror", function () {
  const a = npc(10);
  const b = npc(11);
  // 1–1 tie; the last-evicted juror (npc(2)) voted b → b wins.
  assert.equal(tallyJury([npc(1), npc(2)], [a, b], (j) => (j === npc(1) ? a : b), [npc(1), npc(2)]), b);
});

// --- NPC decisions are relationship-driven ------------------------------------

Given("an NPC holds power at a decision point", function (this: BbWorld) {
  this.npc = npc(1); // the NPC HOH
});

When("it nominates or votes across many seeded runs", function () {
  // The assertion drives the seeded runs.
});

// regex: the step text contains "(" and "/".
Then(
  /^its target reflects its relationship reads \(threat \/ trust\), not chance$/,
  function (this: BbWorld) {
    const hoh = this.npc!;
    const active = [hoh, npc(2), npc(3), npc(4), npc(5), npc(6)];
    for (let seed = 1; seed <= 20; seed++) {
      const rng = new SeededRandom(seed);
      const rel = new RelationshipModel(0.5);
      for (const x of active) if (x !== hoh) rel.edge(hoh, x).threat = rng.next();
      const noms = chooseNominations(hoh, active, rel);
      const ranked = active.filter((h) => h !== hoh).sort((p, q) => rel.edge(hoh, q).threat - rel.edge(hoh, p).threat);
      assert.deepEqual([...noms].sort(), [ranked[0]!, ranked[1]!].sort(), `seed ${seed}: nominations track threat`);
    }
  },
);

// --- Player decision point ----------------------------------------------------

Given("the player holds power at a decision point", function (this: BbWorld) {
  // B55: the LIVE loop is the one decision machine — put the PLAYER in the HOH seat at the
  // nominations beat and let `advance` surface the pending decision itself.
  const { ctx, rng, ids } = liveCtx(7);
  const s = newLiveSeason(ids);
  s.beat = "nominations";
  s.hoh = PLAYER;
  assert.equal(advance(s, ctx, rng), null, "the loop pauses on the player's decision");
  this.liveNom = { s, ctx, rng };
});

Then("the loop surfaces the pending decision and its legal options", function (this: BbWorld) {
  const { s } = this.liveNom!;
  const p = s.pending!;
  assert.equal(p.kind, "nominations");
  assert.equal(p.by, PLAYER);
  assert.equal((p as { pick: number }).pick, 2);
  assert.deepEqual((p as { options: string[] }).options, s.active.filter((h) => h !== PLAYER));
});

Then("it rejects any choice that violates an eligibility rule", function (this: BbWorld) {
  const { s, ctx, rng } = this.liveNom!;
  // Illegal choices throw BEFORE any state moves, so the pending decision survives each refusal.
  assert.throws(() => applyDecision(s, { kind: "nominations", choice: [PLAYER, npc(1)] }, ctx, rng));
  assert.throws(() => applyDecision(s, { kind: "nominations", choice: [npc(1), npc(1)] }, ctx, rng));
  assert.ok(s.pending, "the pending decision survives illegal attempts");
  assert.doesNotThrow(() => applyDecision(s, { kind: "nominations", choice: [npc(1), npc(2)] }, ctx, rng));
});
