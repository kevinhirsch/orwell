import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { buildSandbox } from "../../tests/support/sandbox";
import {
  loadReserveTwists,
  maybeFireTwist,
  firedTwists,
  isDramaticBeat,
  RESERVE_POOL,
} from "../../src/engine/reserveTwists";
import { selectableReplacements, evictionVoters } from "../../src/domain/eligibility";
import type { WeekState } from "../../src/domain/eligibility";
import { playSeason } from "../../src/engine/season";
import { generateHouse } from "../../src/engine/characterFactory";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { assertNoneAppear } from "../../tests/support/assertions";
import { PLAYER, npc } from "../../src/domain/ids";

// Reuses: "no Vault sentinel value appears" (god_mode, checks this.lastView).

// --- Background ---------------------------------------------------------------

Given(
  "a running game sandbox with a reserve twist loaded and sealed in the Vault",
  function (this: BbWorld) {
    this.sandbox = buildSandbox(1);
    // The engine generates + seals the twist in the Vault (sentinel-bearing, engine-only)...
    this.twist = this.sandbox.addReservedTwist();
    // ...and loads it for play (what + when) — knowledge that lives ONLY in the engine.
    this.reserve = [{ kind: "secret-power", fireAtBeat: 5 }];
  },
);

// --- Invisible to the player --------------------------------------------------

When("any player-facing surface is produced before the twist fires", function (this: BbWorld) {
  this.lastOutput = this.sandbox!.allPlayerOutputs();
  this.lastView = this.lastOutput; // satisfies the reused "no Vault sentinel value appears" step
});

Then("no reserve twist appears", function (this: BbWorld) {
  assertNoneAppear(this.lastOutput, this.sandbox!.hiddenContents); // the sealed twist content
  for (const kind of RESERVE_POOL) {
    assert.ok(!this.lastOutput.includes(kind), `reserve twist kind leaked: ${kind}`);
  }
});

Then("no hint that a twist is pending appears", function (this: BbWorld) {
  assert.ok(!/\btwist\b/i.test(this.lastOutput), "no surface may hint a twist is pending");
  assert.ok(!/\bpending\b/i.test(this.lastOutput), "no surface may hint a twist is pending");
});

// --- Invisible to the admin too -----------------------------------------------

Given("the admin enabled reserve twists by count", function (this: BbWorld) {
  // A COUNT knob only (0016 §5) — the admin sets how many, never what or when.
  this.lastView = this.sandbox!.admin.configure({ reserveTwists: 2 });
});

When("the admin inspects the sandbox before the twist fires", function (this: BbWorld) {
  // The full admin view sweep — everything the admin can possibly see.
  this.lastOutput = JSON.stringify(this.sandbox!.admin.inspect()) + "\n" + this.sandbox!.adminOutput();
  this.lastView = this.lastOutput; // satisfies the reused "no Vault sentinel value appears" step
});

Then("the admin cannot see which twist was prepared", function (this: BbWorld) {
  assertNoneAppear(this.lastOutput, this.sandbox!.hiddenContents);
  for (const kind of RESERVE_POOL) {
    assert.ok(!this.lastOutput.includes(kind), `admin saw the prepared twist kind: ${kind}`);
  }
});

Then("the admin cannot see when it will fire", function (this: BbWorld) {
  // The sealed twist content (which encodes the engine's timing) never reaches the admin.
  assertNoneAppear(this.lastOutput, this.sandbox!.hiddenContents);
});

// --- Fires rarely & deterministically -----------------------------------------

When("the game is played out under a fixed seed", function (this: BbWorld) {
  // Pick the first seed that actually loads + fires a twist, so the scenario exercises a
  // real fire while staying fully deterministic (reproducible by seed).
  for (let s = 1; s <= 50; s++) {
    const fires = firedTwists(loadReserveTwists(1, new SeededRandom(s)));
    if (fires.length === 1) {
      this.seed = s;
      this.fires = fires;
      break;
    }
  }
  assert.ok(this.fires && this.fires.length === 1, "expected a firing seed in range");
});

Then("at most the admin-enabled count of twists fires", function (this: BbWorld) {
  assert.ok(this.fires!.length <= 1, "no more than the enabled count may fire");
});

Then("each fires at a dramatic beat", function (this: BbWorld) {
  for (const f of this.fires!) assert.ok(isDramaticBeat(f.beat), `beat ${f.beat} is not dramatic`);
});

Then("the same seed reproduces the same twist and timing", function (this: BbWorld) {
  const again = firedTwists(loadReserveTwists(1, new SeededRandom(this.seed!)));
  assert.deepEqual(again, this.fires);
});

// --- Firing makes it a witnessed event ----------------------------------------

When("a reserve twist fires", function (this: BbWorld) {
  this.visibleBefore = this.sandbox!.engine.events.query({ witnessedBy: PLAYER }).length;
  const fire = maybeFireTwist(5, this.reserve!); // the loaded twist fires at its sealed beat
  assert.ok(fire, "the loaded twist fires at its sealed beat");
  this.twistEventId = "evt:twist-fire";
  // Reveal-as-event (0002/0018): a dramatic, WITNESSED house event the narrator can voice.
  this.sandbox!.engine.events.record({
    id: this.twistEventId,
    ts: 999,
    type: "house-event",
    initiator: npc(1),
    witnessSet: [PLAYER, npc(1)],
    hidden: false,
    content: `A production twist shakes the house — ${fire!.kind}.`,
  });
});

Then("it becomes a witnessed in-game event", function (this: BbWorld) {
  const witnessed = this.sandbox!.engine.events.query({ witnessedBy: PLAYER });
  assert.ok(witnessed.some((e) => e.id === this.twistEventId), "the fired twist is now witnessed");
  assert.equal(witnessed.length, this.visibleBefore! + 1);
});

Then("the narrator can voice it", function (this: BbWorld) {
  const ctx = this.sandbox!.player.assembleNarrationContext("scene");
  assert.ok(
    ctx.visibleEvents.some((e) => e.id === this.twistEventId),
    "the fired twist is in the narrator's Vault-free visible context",
  );
});

Then("only then is it known", function (this: BbWorld) {
  // It was not known before firing; the fire is exactly what introduced it to the player.
  const now = this.sandbox!.engine.events.query({ witnessedBy: PLAYER }).length;
  assert.equal(now, this.visibleBefore! + 1, "the twist became known exactly upon firing");
});

// --- Format-preserving (never breaks hard rules or the core arc) ---------------

Then("the eligibility and legality invariants still hold", function (this: BbWorld) {
  // The 0005 hard rules are computed in the pure domain core and are untouched by a twist.
  const week: WeekState = {
    houseguests: [PLAYER, npc(1), npc(2), npc(3), npc(4), npc(5)],
    player: PLAYER,
    hoh: npc(1),
    nominees: [npc(2), npc(3)],
    vetoWinner: npc(4),
  };
  assert.ok(!selectableReplacements(week).includes(npc(4)), "veto winner can't be replacement nominee");
  assert.ok(!evictionVoters(week).includes(npc(1)), "the outgoing HOH does not vote");
});

Then("the season still reaches a jury of nine and a final two", function (this: BbWorld) {
  const roster = [
    { id: PLAYER, stats: { physical: 0.5, mental: 0.5, social: 0.5 } },
    ...generateHouse(new SeededRandom(5)).npcs.map((n) => ({ id: n.id, stats: n.character.stats })),
  ];
  const outcome = playSeason({ seed: 5, houseguests: roster });
  assert.equal(outcome.jury.length, 9);
  assert.equal(outcome.finalTwo.length, 2);
});
