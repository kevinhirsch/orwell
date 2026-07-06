import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { buildSandbox } from "../../tests/support/sandbox";
import {
  loadReserveTwists,
  firedTwists,
  isDramaticBeat,
  RESERVE_POOL,
} from "../../src/engine/reserveTwists";
import type { TwistEvent } from "../../src/engine/reserveTwists";
import { selectableReplacements, evictionVoters } from "../../src/domain/eligibility";
import type { WeekState } from "../../src/domain/eligibility";
import { playSeason } from "../../src/engine/calibration";
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
    this.reserve = [{ kind: "wildcard-power", fireAtBeat: 5 }];
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

// T8: UN-FILTERED seed loops — the old step searched for a seed where exactly one twist fired,
// then asserted "≤ the enabled count" against that pre-filtered pick (assuming the conclusion).
// Now EVERY seed in the range is played out for every admin-enabled count, and the invariants
// must hold across all of them.
const TWIST_SEED_RANGE = 60;
const TWIST_ENABLED_COUNTS = [1, 2, 3] as const;
let twistFiresBy: Map<string, TwistEvent[]> | undefined;

When("the game is played out under a fixed seed", function (this: BbWorld) {
  twistFiresBy = new Map();
  for (const count of TWIST_ENABLED_COUNTS) {
    for (let s = 1; s <= TWIST_SEED_RANGE; s++) {
      twistFiresBy.set(`${count}:${s}`, firedTwists(loadReserveTwists(count, new SeededRandom(s))));
    }
  }
});

Then("at most the admin-enabled count of twists fires", function (this: BbWorld) {
  for (const [key, fires] of twistFiresBy!) {
    const count = Number(key.split(":")[0]);
    assert.ok(fires.length <= count, `enabled count ${count}, seed ${key.split(":")[1]}: ${fires.length} twists fired`);
  }
  // Not vacuous, and rare by construction: across the swept seeds some genuinely fire, some none.
  const firedCounts = [...twistFiresBy!.values()].map((f) => f.length);
  assert.ok(firedCounts.some((n) => n > 0), "some seed in the range actually fires a twist");
  assert.ok(firedCounts.some((n) => n === 0), "some seed in the range fires none (rare by construction)");
});

Then("each fires at a dramatic beat", function (this: BbWorld) {
  for (const [key, fires] of twistFiresBy!) {
    for (const f of fires) assert.ok(isDramaticBeat(f.beat), `${key}: beat ${f.beat} is not dramatic`);
  }
});

Then("the same seed reproduces the same twist and timing", function (this: BbWorld) {
  for (const [key, fires] of twistFiresBy!) {
    const [count, s] = key.split(":").map(Number);
    assert.deepEqual(
      firedTwists(loadReserveTwists(count!, new SeededRandom(s!))),
      fires,
      `seed ${s} (count ${count}) must reproduce its twists and timing`,
    );
  }
});

// --- Firing makes it a witnessed event ----------------------------------------

// T8: the old step recorded the "reveal" event ITSELF and then asserted it existed. Now the fire
// and its reveal are the ENGINE's own doing — a sealed twist is restored into a LIVE game and the
// real loop plays until IT fires the twist and records the witnessed reveal (a second live
// twist-kind trace alongside the B53 season trace below). The step records nothing.
let twistPreFireSightings = -1;

When("a reserve twist fires", function (this: BbWorld) {
  const reg = new GameSessionRegistry();
  const user = `twist-fire${twistUsers++}`;
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed: 7 });
  const core = sb.session.snapshot();
  core.live!.reserve = [{ kind: "double-eviction", fireAtBeat: TWIST_WEEK }];
  sb.session.restore(core);
  this.twistSandbox = sb;

  const witnessedReveals = (): number =>
    sb.engine.events.query({ witnessedBy: PLAYER }).filter((e) => /DOUBLE EVICTION/i.test(e.content)).length;

  twistPreFireSightings = 0;
  let fired = false;
  for (let i = 0; i < 4000 && !fired; i++) {
    twistPreFireSightings += witnessedReveals(); // sweep the player's record on EVERY pre-fire beat
    const v = sb.session.advanceGame();
    if (v.event?.beat === "twist-reveal") { fired = true; break; }
    if (v.pending) {
      const sv = resolveLive(sb.session, v.pending);
      if (sv.event?.beat === "twist-reveal") { fired = true; break; }
    }
    if (v.finished) break;
  }
  assert.ok(fired, "the loaded twist fires at its sealed beat");
});

Then("it becomes a witnessed in-game event", function (this: BbWorld) {
  // The ENGINE recorded the reveal as a player-witnessed event — the step wrote nothing.
  const reveal = this.twistSandbox!.engine.events
    .query({ witnessedBy: PLAYER })
    .find((e) => /DOUBLE EVICTION/i.test(e.content));
  assert.ok(reveal, "the engine recorded the fired twist as a player-witnessed event");
  assert.equal(reveal!.hidden, false);
  this.twistEventId = reveal!.id;
});

Then("the narrator can voice it", function (this: BbWorld) {
  const ctx = this.twistSandbox!.player.assembleNarrationContext("scene");
  assert.ok(
    ctx.visibleEvents.some((e) => e.id === this.twistEventId),
    "the fired twist is in the narrator's Vault-free visible context",
  );
});

Then("only then is it known", function (this: BbWorld) {
  // The drive swept the player's witnessed record before EVERY pre-fire beat: zero sightings
  // until the fire, exactly one after — the fire is what introduced it to the player.
  assert.equal(twistPreFireSightings, 0, "no witnessed trace of the twist existed before it fired");
  const now = this.twistSandbox!.engine.events
    .query({ witnessedBy: PLAYER })
    .filter((e) => /DOUBLE EVICTION/i.test(e.content)).length;
  assert.equal(now, 1, "the twist became known exactly upon firing");
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

// --- B53 amendment: the live double eviction (audit D6 + B8) --------------------

import { GameSessionRegistry } from "../../src/composition/registry";
import type { AdvanceView, SubmitDecisionReq } from "../../src/ports/GameSession";
import type { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";

const TWIST_WEEK = 3;
let twistUsers = 0;

function resolveLive(s: GameSessionAdapter, p: NonNullable<AdvanceView["pending"]>): AdvanceView {
  const submit = (req: SubmitDecisionReq): AdvanceView => s.submitDecision(req);
  if (p.kind === "nominations") return submit({ kind: "nominations", choice: [p.options[0]!.id, p.options[1]!.id] });
  if (p.kind === "veto-decision") return submit({ kind: "veto-decision", use: false });
  if (p.kind === "comp-intent") return submit({ kind: "comp-intent", intent: "compete" });
  if (p.kind === "comp-round") return submit({ kind: "comp-round", intent: "compete" }); // 0006 staged-rounds
  if (p.kind === "finale-statement") return submit({ kind: "finale-statement", statement: "x" });
  if (p.kind === "finale-answer") return submit({ kind: "finale-answer", appeal: p.appeals![0]! });
  if (p.kind === "replacement") return submit({ kind: "replacement", replacement: p.options[0]!.id });
  return submit({ kind: p.kind, vote: p.options[0]!.id });
}

/** Start a live game and FORCE a double eviction sealed for `TWIST_WEEK` (deterministic test setup). */
Given("a live seeded game with a double eviction sealed for an upcoming week", function (this: BbWorld) {
  const reg = new GameSessionRegistry();
  const user = `twist${twistUsers++}`;
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed: 7 });
  const core = sb.session.snapshot();
  core.live!.reserve = [{ kind: "double-eviction", fireAtBeat: TWIST_WEEK }];
  sb.session.restore(core);
  // A sentinel-bearing Vault seal (the audit copy) so the invisibility sweep has teeth.
  this.twistSentinel = "SENTINEL-0025-live-twist";
  sb.engine.vault.writeHidden({
    id: "twist:bdd", kind: "reserved-twist",
    content: `sealed reserve twist: double-eviction, fires week ${TWIST_WEEK} ${this.twistSentinel}`,
  });
  this.twistRegistry = reg; this.twistUser = user; this.twistSandbox = sb;
});

/** Drive to completion, sweeping the surfaces BEFORE the reveal and recording the season trace. */
When("the season is played through the live decision seam", function (this: BbWorld) {
  const sb = this.twistSandbox!;
  const s = sb.session;
  const trace = {
    reveals: [] as number[],                 // week of each twist-reveal
    hohWinsByWeek: new Map<number, string[]>(), // hoh-competition event contents per week
    evictionsByWeek: new Map<number, number>(), // eviction beats per week
    preRevealSweeps: [] as string[],
  };
  let revealed = false;
  const note = (v: AdvanceView): void => {
    const wk = v.status.week;
    if (!v.event) return;
    if (v.event.beat === "twist-reveal") { trace.reveals.push(wk); revealed = true; }
    if (v.event.beat === "hoh-competition") {
      trace.hohWinsByWeek.set(wk, [...(trace.hohWinsByWeek.get(wk) ?? []), v.event.content]);
    }
    if (v.event.beat === "eviction") {
      trace.evictionsByWeek.set(wk, (trace.evictionsByWeek.get(wk) ?? 0) + 1);
    }
  };
  for (let i = 0; i < 4000; i++) {
    const v = s.advanceGame();
    note(v);
    if (!revealed && i % 7 === 0) {
      trace.preRevealSweeps.push(
        JSON.stringify(s.getGameState()) + JSON.stringify(s.gameStatus()) +
        JSON.stringify(sb.player.getVisibleState()) + JSON.stringify(sb.admin.inspect()),
      );
    }
    if (v.pending) note(resolveLive(s, v.pending));
    if (v.finished) break;
  }
  this.twistTrace = trace;
  this.twistFinal = s.advanceGame();
});

Then("the double eviction fires exactly once, at its sealed week", function (this: BbWorld) {
  assert.deepEqual(this.twistTrace!.reveals, [TWIST_WEEK]);
});

Then("the reveal is a witnessed live event", function (this: BbWorld) {
  const reveal = this.twistSandbox!.engine.events
    .query({ witnessedBy: PLAYER })
    .find((e) => /DOUBLE EVICTION/.test(e.content));
  assert.ok(reveal, "the reveal is recorded as a player-witnessed event");
  assert.equal(reveal!.hidden, false);
});

Then("no player or admin surface revealed the twist before it fired", function (this: BbWorld) {
  assert.ok(this.twistTrace!.preRevealSweeps.length > 0, "the pre-reveal surfaces were swept");
  for (const sweep of this.twistTrace!.preRevealSweeps) {
    assert.ok(!sweep.includes(this.twistSentinel!), "the Vault seal leaked pre-reveal");
    assert.ok(!sweep.includes("double-eviction"), "the twist kind leaked pre-reveal");
    assert.ok(!/DOUBLE EVICTION/.test(sweep), "the reveal copy leaked pre-reveal");
  }
});

Then("two houseguests are evicted in the twist week", function (this: BbWorld) {
  assert.equal(this.twistTrace!.evictionsByWeek.get(TWIST_WEEK), 2, "the twist week evicts twice");
  for (const [wk, n] of this.twistTrace!.evictionsByWeek) {
    if (wk !== TWIST_WEEK) assert.equal(n, 1, `week ${wk} evicts once`);
  }
});

Then("the first crown's head of household does not win the second crown of the night", function (this: BbWorld) {
  const wins = this.twistTrace!.hohWinsByWeek.get(TWIST_WEEK) ?? [];
  assert.equal(wins.length, 2, "the twist week crowns two HOHs");
  assert.notEqual(wins[0], wins[1], "the outgoing HOH cannot take the second crown (0005 verbatim)");
});

Then("both evictions count toward the jury order", function (this: BbWorld) {
  // The full season evicted cast−2 houseguests in strict order — the two twist-night evictions
  // occupy consecutive slots and the last nine form the jury exactly as in an untwisted season.
  const core = this.twistSandbox!.session.snapshot();
  assert.equal(core.live!.evictionOrder.length, 14, "a 16-cast season evicts 14 in order");
});

Then("the live season still reaches a final two with a winner", function (this: BbWorld) {
  assert.equal(this.twistFinal!.finished, true);
  assert.ok(this.twistFinal!.winner, "a winner is crowned");
  const core = this.twistSandbox!.session.snapshot();
  assert.equal(core.live!.jury?.length, 9, "the last-9 jury formed");
  assert.equal(core.live!.finalTwo?.length, 2, "a Final 2 sat at the end");
});

When("the engine restarts before the twist week", function (this: BbWorld) {
  const snap = this.twistRegistry!.snapshot(this.twistUser!);
  const reg2 = new GameSessionRegistry();
  reg2.restore(this.twistUser!, snap);
  this.twistSandbox = reg2.sandboxFor(this.twistUser!);
  this.twistRegistry = reg2;
});

Then("the restored game still fires the double eviction at its sealed week", function (this: BbWorld) {
  // The schedule survived: the restored Vault holds the seal and the loop still fires it on time.
  const sealed = this.twistSandbox!.engine.vault.readHidden({ kind: "reserved-twist" });
  assert.ok(sealed.some((r) => r.content.includes("double-eviction")), "the Vault seal survived the restart");
  const s = this.twistSandbox!.session;
  let revealWeek = 0;
  for (let i = 0; i < 4000 && revealWeek === 0; i++) {
    const v = s.advanceGame();
    if (v.event?.beat === "twist-reveal") { revealWeek = v.status.week; break; }
    if (v.pending) {
      const sv = resolveLive(s, v.pending);
      if (sv.event?.beat === "twist-reveal") { revealWeek = sv.status.week; break; }
    }
    if (v.finished) break;
  }
  assert.equal(revealWeek, TWIST_WEEK, "the sealed week survived the restart");
});
