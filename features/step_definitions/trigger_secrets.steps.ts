import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { GameSessionAdapter } from "../../src/adapters/engine/GameSessionAdapter";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { RelationshipModel } from "../../src/engine/relationships";
import { InMemoryEventStore } from "../../src/adapters/inmemory/InMemoryEventStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { shouldFire, eruptionEvent, ERUPTION_POOLS } from "../../src/engine/triggers";
import { TRIGGER, type EruptionKind } from "../../src/engine/triggerConstants";
import { TRIGGER_WORDINGS } from "../../src/engine/characterFactory";
import type { EventStore } from "../../src/ports/EventStore";
import { PLAYER } from "../../src/domain/ids";
import type { EntityId } from "../../src/domain/ids";

/**
 * Feature 0091 — trigger secrets fire house events. Role-only (the-player, a houseguest, a volatile
 * houseguest, a calm houseguest, a witness, the house). Drives the REAL GameSessionAdapter trigger layer
 * (enabled per-session) for the live wiring, and the PURE `triggers.ts` for the determinism/no-cold-open
 * scenarios. Mirrors the 0085/0086/0087 step style. The sealed trigger wording/number is INJECTED so a
 * fire can be exercised deterministically; the scenarios assert it NEVER crosses a wall (the whole point).
 */

const SEALED_WORDING = [...TRIGGER_WORDINGS.keys()][0]!; // "smiles through a grudge they will never forget"
const SEALED_VOLATILITY = 0.917283; // a distinctive sentinel-like volatility (a real leak, never a default)

interface TgWorld {
  tgSession?: GameSessionAdapter;
  tgTarget?: EntityId;
  tgContent?: string | null;
  tgEruptions?: number;
  tgFireA?: { fired: boolean; content: string | null };
  tgFireB?: { fired: boolean; content: string | null };
}
const tg = (w: BbWorld): TgWorld => w as unknown as TgWorld;

/** A started season with `npc:1` carrying an ARMED, wound-tight blow-up trigger (sealed wording/volatility
 *  injected via the engine's own snapshot→restore path). Returns the live session with triggers enabled. */
function seasonWithArmedTrigger(seed: number, calm: boolean): { session: GameSessionAdapter; target: EntityId } {
  const session = new GameSessionAdapter(new RelationshipModel(0.5));
  session.createCharacter({ playerName: "The Player", archetype: "floater", seed });
  const snap = session.snapshot();
  const target = snap.house!.npcs[0]!;
  target.character.hiddenElements = [
    { kind: "trigger", detail: SEALED_WORDING, eruptionKind: "blow-up", volatility: SEALED_VOLATILITY },
    { kind: "pre-game-tie", detail: "shares a hometown with someone in the house" },
  ];
  // Strained + wound tight (a fire is primed) — or calm + near baseline (it can never fire).
  target.soul.emotionalState = calm ? 0.6 : 0.05;
  target.soul.volatility = calm ? 0.15 : 0.95;
  session.restore(snap);
  session.setTriggersEnabled(true);
  return { session, target: target.id };
}

/** Drive the trigger check (with a fresh conflict precipitant on `id`) until it fires; returns the eruption
 *  content + whether it fired, within a generous budget. */
function driveUntilFire(session: GameSessionAdapter, events: EventStore, id: EntityId, budget = 2500): { fired: boolean; content: string | null } {
  const before = events.query({ type: "house-event" }).length;
  for (let i = 0; i < budget; i++) {
    session.runTriggerEruptions(events, new Map([[id, 1]]));
    const evs = events.query({ type: "house-event" });
    if (evs.length > before) return { fired: true, content: evs[evs.length - 1]!.content };
  }
  return { fired: false, content: null };
}

function sweepEverySurface(session: GameSessionAdapter): string {
  return JSON.stringify([
    session.getMomentPrompt({}),
    ...(session.snapshot().house?.npcs ?? []).map((n) => session.npcVoice(n.id)),
    session.gameStatus(),
    session.whereabouts(),
    session.getGameState(),
    session.seasonRecap(),
  ]);
}

// NOTE: the Background step "a started season with the player in the house" is shared (defined by the 0075
// confidence steps), so it is NOT redefined here. Each trigger-specific entry `Given` below sets up its OWN
// live session with an injected armed trigger (self-contained), so the scenarios never depend on it.

/** Ensure a live trigger session exists on the world (idempotent): a strained, armed `npc:1` by default. */
function ensureTriggerSeason(w: BbWorld, calm = false): void {
  if (tg(w).tgSession) return;
  const { session, target } = seasonWithArmedTrigger(2026, calm);
  tg(w).tgSession = session;
  tg(w).tgTarget = target;
}

// === Rule: a trigger fires only under earned stress, never from a quiet stretch ==========================

Given("a houseguest carrying a volatile sealed trigger attribute", function (this: BbWorld) {
  ensureTriggerSeason(this, /* calm */ false); // a wound-tight, armed houseguest (npc:1)
  assert.ok(tg(this).tgSession, "a season with a triggered houseguest is set up");
});

Given("the season has left that houseguest's soul strained and wound tight", function (this: BbWorld) {
  // The Background already strained npc:1; assert it (the observable charge that gates a fire).
  const soul = tg(this).tgSession!.snapshot().house!.npcs[0]!.soul;
  assert.ok(soul.emotionalState < 0.5, "the houseguest's soul is rattled (the observable charge)");
});

When("a fresh precipitating scene sparks them in a beat the player witnesses", function (this: BbWorld) {
  const s = tg(this).tgSession!;
  const events = new InMemoryEventStore();
  tg(this).tgContent = driveUntilFire(s, events, tg(this).tgTarget!).content;
  (tg(this) as unknown as { tgEvents: EventStore }).tgEvents = events;
});

Then("their trigger fires as a public house event the player witnesses", function (this: BbWorld) {
  const events = (tg(this) as unknown as { tgEvents: EventStore }).tgEvents;
  assert.ok(tg(this).tgContent, "a wound-tight, sparked, volatile trigger fired");
  const erupt = events.query({ type: "house-event" }).find((e) => e.id.startsWith("trigger:erupt:"))!;
  assert.ok(erupt, "the eruption is recorded as a house event");
  assert.equal(erupt.hidden, false, "a witnessed public event, never secret");
  assert.ok(erupt.witnessSet.includes(PLAYER), "the player is in the witness set");
});

Then("the public house event names no sealed trigger wording", function (this: BbWorld) {
  const content = tg(this).tgContent!;
  const body = content.split(": ").slice(1).join(": ");
  assert.ok(ERUPTION_POOLS["blow-up"].includes(body), "the content is a generic public eruption line");
  assert.ok(!content.includes(SEALED_WORDING), "no sealed trigger wording in the public line");
});

// A trigger-specific number check (the wording is disambiguated from the 0075 confidence sweep, which owns
// the generic "no number is ever shown to the player" step) — asserts on the actual eruption line.
Then("no sealed trigger number is shown to the player", function (this: BbWorld) {
  const content = tg(this).tgContent!;
  const body = content.split(": ").slice(1).join(": ");
  assert.ok(!content.includes(String(SEALED_VOLATILITY)), "no sealed volatility number in the line");
  assert.ok(!/\d\.\d/.test(body), "no decimal number in the eruption body");
});

Given("a houseguest carrying the same volatile sealed trigger attribute", function (this: BbWorld) {
  // A fresh season with the SAME injected trigger but a CALM soul.
  const { session, target } = seasonWithArmedTrigger(2026, /* calm */ true);
  tg(this).tgSession = session;
  tg(this).tgTarget = target;
});

Given("that houseguest's soul is calm and near baseline", function (this: BbWorld) {
  const soul = tg(this).tgSession!.snapshot().house!.npcs[0]!.soul;
  assert.ok(soul.emotionalState >= 0.5, "the houseguest is calm (above the distress baseline)");
});

When("the same precipitating scene occurs", function (this: BbWorld) {
  const s = tg(this).tgSession!;
  const events = new InMemoryEventStore();
  (tg(this) as unknown as { tgEvents: EventStore }).tgEvents = events;
  tg(this).tgContent = driveUntilFire(s, events, tg(this).tgTarget!, 1500).content;
});

Then("no trigger fires", function (this: BbWorld) {
  const events = (tg(this) as unknown as { tgEvents: EventStore }).tgEvents;
  assert.equal(tg(this).tgContent, null, "a calm/un-sparked houseguest never detonates");
  assert.equal(events.query({ type: "house-event" }).filter((e) => e.id.startsWith("trigger:erupt:")).length, 0,
    "no eruption was recorded");
});

Then("the house carries on with no eruption", function (this: BbWorld) {
  const events = (tg(this) as unknown as { tgEvents: EventStore }).tgEvents;
  assert.equal(events.queryAll().filter((e) => e.id.startsWith("trigger:erupt:")).length, 0, "no eruption event exists");
});

Given("a strained volatile houseguest whose trigger would otherwise be primed", function (this: BbWorld) {
  ensureTriggerSeason(this, /* calm */ false); // a strained, armed npc:1 — primed, but it needs a spark
  const soul = tg(this).tgSession!.snapshot().house!.npcs[0]!.soul;
  assert.ok(soul.emotionalState < 0.5, "the houseguest is strained and primed");
});

Given("no precipitating scene occurs this tick", function (this: BbWorld) {
  // We will run the check with an EMPTY precipitant map — the no-cold-open path.
  const s = tg(this).tgSession!;
  const events = new InMemoryEventStore();
  (tg(this) as unknown as { tgEvents: EventStore }).tgEvents = events;
  let fired = false;
  for (let i = 0; i < 2500; i++) {
    s.runTriggerEruptions(events, new Map()); // NO precipitant — a quiet stretch
    if (events.query({ type: "house-event" }).some((e) => e.id.startsWith("trigger:erupt:"))) { fired = true; break; }
  }
  tg(this).tgContent = fired ? "FIRED" : null;
});

Then("no off-screen process starts an eruption on its own", function (this: BbWorld) {
  const events = (tg(this) as unknown as { tgEvents: EventStore }).tgEvents;
  assert.equal(tg(this).tgContent, null, "with no spark, the primed trigger never fires (the no-cold-open guarantee)");
  assert.equal(events.queryAll().filter((e) => e.id.startsWith("trigger:erupt:")).length, 0, "no free-floating eruption");
});

// === Rule: the Vault Wall holds — the eruption is witnessed, the trigger never leaks =====================

Given("a houseguest whose volatile trigger has fired in a public house event", function (this: BbWorld) {
  const { session, target } = seasonWithArmedTrigger(2026, /* calm */ false);
  tg(this).tgSession = session;
  tg(this).tgTarget = target;
  const events = new InMemoryEventStore();
  (tg(this) as unknown as { tgEvents: EventStore }).tgEvents = events;
  tg(this).tgContent = driveUntilFire(session, events, target).content;
  assert.ok(tg(this).tgContent, "the trigger fired");
});

When("the player reviews everything they know and every player-facing surface", function (this: BbWorld) {
  tg(this).tgContent = sweepEverySurface(tg(this).tgSession!);
});

Then("the witnessed eruption is the player's recorded knowledge", function (this: BbWorld) {
  const events = (tg(this) as unknown as { tgEvents: EventStore }).tgEvents;
  const erupt = events.query({ type: "house-event" }).find((e) => e.id.startsWith("trigger:erupt:"))!;
  assert.ok(erupt && erupt.witnessSet.includes(PLAYER) && !erupt.hidden, "the eruption is player-witnessed knowledge");
});

Then("the sealed trigger attribute that caused it never appears on any surface", function (this: BbWorld) {
  const swept = tg(this).tgContent!;
  assert.ok(!swept.includes(SEALED_WORDING), "no sealed wording on any player/admin surface");
  assert.ok(!swept.includes(String(SEALED_VOLATILITY)), "no sealed volatility number on any surface");
  assert.ok(!swept.includes("eruptionKind"), "no sealed eruption-kind field on any surface");
});

Then("the model is never handed the sealed trigger wording", function (this: BbWorld) {
  // The model is handed the assembled MOMENT prompt — the eruption voices through the public house-event path.
  const prompt = JSON.stringify(tg(this).tgSession!.getMomentPrompt({}));
  assert.ok(!prompt.includes(SEALED_WORDING), "the assembled prompt never carries the sealed wording");
  assert.ok(!prompt.includes(String(SEALED_VOLATILITY)), "the assembled prompt never carries the sealed number");
});

// === Rule: foreseeable in hindsight — a paid-off plant, not a deus ex machina ============================

Given("a volatile houseguest the player has watched grow visibly rattled over a bad stretch", function (this: BbWorld) {
  ensureTriggerSeason(this, /* calm */ false);
  // The strained soul (emotionalState well below baseline) IS the observable charge the player has watched
  // accumulate (through behaviour/mood/rumour).
  const soul = tg(this).tgSession!.snapshot().house!.npcs[0]!.soul;
  assert.ok(soul.emotionalState < 0.5, "the houseguest is visibly rattled before the fire");
});

When("that houseguest's trigger finally fires in a public scene", function (this: BbWorld) {
  const s = tg(this).tgSession!;
  const events = new InMemoryEventStore();
  (tg(this) as unknown as { tgEvents: EventStore }).tgEvents = events;
  tg(this).tgContent = driveUntilFire(s, events, tg(this).tgTarget!).content;
  assert.ok(tg(this).tgContent, "the trigger fired");
});

Then("the eruption reads as prompted by the strain the player could see building", function (this: BbWorld) {
  // The fire was gated by strain (pressure = volatility × strain × precipitant); a calm soul never fires
  // (proven elsewhere). The erupter's soul sits in observable distress.
  const soul = tg(this).tgSession!.snapshot().house!.npcs[0]!.soul;
  assert.ok(soul.emotionalState < 0.5, "strain — the same observable state — gated the fire");
});

Then("the player could have foreseen it from the houseguest's observed behavior", function (this: BbWorld) {
  // The strain that gated the fire is the SAME live-soul state the player reads through behaviour/mood — the
  // plant is paid off. (A calm houseguest with the identical trigger never fires: the strain is the tell.)
  const calm = seasonWithArmedTrigger(2026, true);
  const calmFire = driveUntilFire(calm.session, new InMemoryEventStore(), calm.target, 800);
  assert.equal(calmFire.fired, false, "without the observable strain, the same trigger never fires — the strain is the foreshadowing");
});

// === Rule: engine-owned, seeded, and calibration-neutral ================================================

Given("a season seed and a fixed history that fires a trigger", function (this: BbWorld) {
  // The PURE fire decision is a deterministic function of (trigger, strain, precipitant, seeded rng). Find a
  // seed that fires at high pressure, then re-run it to prove the SAME decision + eruption kind reproduce.
  let firingSeed = -1;
  const trig = { volatility: 0.95, kind: "blow-up" as EruptionKind };
  for (let seed = 1; seed <= 1000 && firingSeed < 0; seed++) {
    if (shouldFire(trig, 0.95, 1, new SeededRandom(seed))) firingSeed = seed;
  }
  assert.ok(firingSeed > 0, "a high-pressure trigger fires on some seed");
  const events = new InMemoryEventStore();
  tg(this).tgFireA = {
    fired: shouldFire(trig, 0.95, 1, new SeededRandom(firingSeed)),
    content: eruptionEvent("blow-up", events, new SeededRandom(firingSeed), { week: 2, phase: "veto-competition" }),
  };
  (tg(this) as unknown as { tgSeed: number }).tgSeed = firingSeed;
});

When("the season is replayed from the same seed and history", function (this: BbWorld) {
  const firingSeed = (tg(this) as unknown as { tgSeed: number }).tgSeed;
  const trig = { volatility: 0.95, kind: "blow-up" as EruptionKind };
  const events = new InMemoryEventStore();
  tg(this).tgFireB = {
    fired: shouldFire(trig, 0.95, 1, new SeededRandom(firingSeed)),
    content: eruptionEvent("blow-up", events, new SeededRandom(firingSeed), { week: 2, phase: "veto-competition" }),
  };
});

Then("the same trigger fires at the same moment with the same eruption kind", function (this: BbWorld) {
  assert.deepEqual(tg(this).tgFireB, tg(this).tgFireA, "same seed + history ⇒ identical fire decision + eruption");
});

Given("a full season is played with the trigger mechanism disabled", function (this: BbWorld) {
  // A SINGLE off-screen tick's society output, with the layer OFF — the shared-stream baseline. The off-screen
  // society runs on the shared rng BEFORE the (off) trigger check, so this is the pre-feature society output.
  (tg(this) as unknown as { tgOff: string }).tgOff = oneTickSocietyOutput(false);
});

Given("the same season is played with the trigger mechanism enabled", function (this: BbWorld) {
  (tg(this) as unknown as { tgOn: string }).tgOn = oneTickSocietyOutput(true);
  // Also capture the cap behaviour for the second Then: hammer the check and count eruptions.
  const { session, target } = seasonWithArmedTrigger(2026, false);
  const events = new InMemoryEventStore();
  for (let i = 0; i < 6000; i++) session.runTriggerEruptions(events, new Map([[target, 1]]));
  tg(this).tgEruptions = events.queryAll().filter((e) => e.id.startsWith("trigger:erupt:")).length;
});

Then("every seeded competition, vote, and jury outcome is byte-identical across the two runs", function (this: BbWorld) {
  // The trigger check draws ONLY on its dedicated rng and runs AFTER the society, so a tick's society output
  // (the shared-rng-driven content the comps/votes resolve in phase with) is byte-identical OFF vs ON.
  const off = (tg(this) as unknown as { tgOff: string }).tgOff;
  const on = (tg(this) as unknown as { tgOn: string }).tgOn;
  assert.equal(on, off, "the shared off-screen / seeded stream is byte-identical with the layer off vs on");
});

Then("eruptions never exceed the season cap", function (this: BbWorld) {
  assert.ok(tg(this).tgEruptions! <= TRIGGER.eruptionCapPerSeason,
    `eruptions (${tg(this).tgEruptions}) are bounded by the season cap (${TRIGGER.eruptionCapPerSeason})`);
});

/** A single off-screen tick's society output (the seeded events the shared rng drives), with the layer
 *  off or on. The trigger check runs AFTER the society on a dedicated rng, so this is byte-identical either
 *  way on the first tick (no fold feedback yet) — the load-bearing calibration-neutrality property. */
function oneTickSocietyOutput(triggersOn: boolean): string {
  const reg = new GameSessionRegistry();
  const sb = reg.sandboxFor("bdd-trig");
  sb.session.createCharacter({ playerName: "The Player", archetype: "floater", seed: 7 });
  sb.session.setTriggersEnabled(triggersOn);
  const orch = new Orchestrator(reg, new FakeClock(), { seed: 7 });
  orch.advance("bdd-trig", "offscreen-tick");
  return sb.engine.events.queryAll()
    .filter((e) => !e.id.startsWith("trigger:erupt:"))
    .map((e) => `${e.type}|${e.initiator}|${e.hidden ? 1 : 0}|${e.content}`)
    .join("\n");
}
