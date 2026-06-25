import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { BbWorld } from "../support/world";
import { GameSessionRegistry } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { composeRuntime } from "../../src/composition/runtime";
import { GameWatcher } from "../../src/composition/gameWatcher";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { SystemClock } from "../../src/adapters/time/SystemClock";
import { diffuseGossip, makeSocialGraph } from "../../src/engine/gossip";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

// Features 0038 (live off-screen society) + 0035 (the running watcher). FAKE clock only — no real
// timers in tests. HARD rule: roles only — no fixture names.

let osUsers = 0;
function osGame(w: BbWorld, seed: number): void {
  const reg = new GameSessionRegistry();
  const user = `os${osUsers++}`;
  const orch = new Orchestrator(reg, { now: () => seed }, { seed });
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed });
  w.osRegistry = reg; w.osUser = user; w.osSandbox = sb; w.osOrch = orch;
}

/**
 * Wire the 0031-style world too, so the SHARED watcher step phrases (defined once in
 * game_orchestrator.steps.ts: "the clock advances past the idle threshold", the bounded-advance
 * and no-hidden-state Thens, the audit-isolation When) drive THIS feature's fixture as well.
 */
function osWatcherWorld(w: BbWorld, seed: number): void {
  w.fakeClock = new FakeClock();
  w.registry = new GameSessionRegistry();
  w.orchestrator = new Orchestrator(w.registry, w.fakeClock, { seed });
  w.watcher = new GameWatcher(w.registry, w.orchestrator, w.fakeClock, w.fakeClock, {
    tickEveryMs: 1000, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0,
  });
  w.registry.sandboxFor("user-a").session.createCharacter({ playerName: "Idle", seed });
  w.orchestrator.touch("user-a");
}

const TYPED = new Set(["alliance", "gossip", "conflict", "bonding", "strategy", "showmance", "betrayal"]);

// --- 0038 Scenario: more than one kind of interaction --------------------------------

Given("a started game the player has left idle", function (this: BbWorld) {
  osGame(this, 21);
  osWatcherWorld(this, 21); // the shared 0031 watcher steps drive this fixture too (0035)
});

When("the off-screen watcher runs several ticks", function (this: BbWorld) {
  for (let t = 0; t < 8; t++) assert.equal(this.osOrch!.advance(this.osUser!, "offscreen-tick").integrity, "ok");
});

Then("more than one kind of NPC-to-NPC interaction occurs off-screen", function (this: BbWorld) {
  const kinds = new Set(this.osSandbox!.engine.events.query().filter((e) => e.hidden && TYPED.has(e.type)).map((e) => e.type));
  assert.ok(kinds.size > 1, `varied off-screen life (saw: ${[...kinds].join(",")})`);
});

Then("none of it is witnessed by the player", function (this: BbWorld) {
  const scenes = this.osSandbox!.engine.events.query().filter((e) => TYPED.has(e.type) && e.id.startsWith("offscreen:"));
  assert.ok(scenes.length > 0);
  for (const s of scenes) assert.ok(!s.witnessSet.includes(PLAYER), "the player witnesses no off-screen scene");
});

// --- 0038 Scenario: information travels and drifts ------------------------------------

Given("a hidden fact known to one houseguest", function (this: BbWorld) {
  osGame(this, 22);
  this.osFactOrigin = npc(1);
});

When("the off-screen society runs", function (this: BbWorld) {
  // The same diffusion machinery the live tick wires (deterministic fixture graph for the spread).
  const ids = [npc(1), npc(2), npc(3), npc(4), npc(5)];
  const edges = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b] as const));
  const { factId } = diffuseGossip({
    knowledge: this.osSandbox!.engine.knowledge,
    graph: makeSocialGraph(edges),
    rng: new SeededRandom(7),
    origin: this.osFactOrigin!,
    fact: { content: "a houseguest has a final-two nobody knows about" },
    rounds: 3,
  });
  this.osFactId = factId;
});

Then("the fact diffuses to other houseguests along the social graph", function (this: BbWorld) {
  const holders = [npc(2), npc(3), npc(4), npc(5)].filter((id) =>
    this.osSandbox!.engine.knowledge.knownTo(id).some((k) => k.factId === this.osFactId));
  assert.ok(holders.length >= 1, "the rumor spread beyond its origin");
});

Then("it carries a source and a confidence that decays with distance", function (this: BbWorld) {
  for (const id of [npc(2), npc(3), npc(4), npc(5)]) {
    const k = this.osSandbox!.engine.knowledge.knownTo(id).find((f) => f.factId === this.osFactId);
    if (!k) continue;
    assert.ok(k.source, "provenance travels with the belief");
    assert.ok((k.confidence ?? 1) < 1, "confidence decays away from the origin");
  }
});

Then("its content may drift from the original with each retelling", function (this: BbWorld) {
  const drifted = [npc(2), npc(3), npc(4), npc(5)]
    .map((id) => this.osSandbox!.engine.knowledge.knownTo(id).find((f) => f.factId === this.osFactId))
    .filter((k): k is NonNullable<typeof k> => !!k);
  assert.ok(drifted.some((k) => k.content !== k.originalContent), "a retelling drifted");
});

// --- 0038 Scenario: a distorted rumor reaches the player --------------------------------

Given("the off-screen society has diffused a fact toward the player", function (this: BbWorld) {
  // Drive the LIVE tick (the production wiring) until a rumor chain terminates at the player. A generous
  // seed search — WHICH seed lands a player-terminating chain shifted when the player began entering the
  // living room (more scenes fall in their earshot), but the diffusion-to-player itself is unchanged.
  // A genuine GOSSIP rumor (not a direct telling): a `told-by:` pathway carrying provenance + decayed
  // confidence — that's the diffusion this scenario is about.
  const isRumor = (f: { pathway: string; source?: unknown; confidence?: number }): boolean =>
    f.pathway.startsWith("told-by:") && !!f.source && (f.confidence ?? 1) < 1;
  for (const seed of Array.from({ length: 24 }, (_, i) => i + 1)) {
    osGame(this, seed);
    for (let t = 0; t < 60; t++) {
      assert.equal(this.osOrch!.advance(this.osUser!, "offscreen-tick").integrity, "ok", "legal gossip never reads as a leak");
      if (this.osSandbox!.engine.knowledge.knownTo(PLAYER).some(isRumor)) return;
    }
  }
  assert.fail("no rumor terminated at the player across the seed set");
});

When("a diffusion pathway terminates at the player", function (this: BbWorld) {
  this.osPlayerRumor = this.osSandbox!.engine.knowledge.knownTo(PLAYER)
    .find((f) => f.pathway.startsWith("told-by:") && !!f.source && (f.confidence ?? 1) < 1);
  assert.ok(this.osPlayerRumor, "the player holds the rumor");
});

Then("the player's knowledge gains the belief with its source and confidence", function (this: BbWorld) {
  assert.ok(this.osPlayerRumor!.source, "the player knows who told them");
  assert.ok((this.osPlayerRumor!.confidence ?? 1) < 1, "a rumor is never certainty");
});

Then("the player is shown no opinion number or hidden state", function (this: BbWorld) {
  const view = JSON.stringify(this.osSandbox!.session.getGameState()) + JSON.stringify(this.osSandbox!.player.getVisibleState());
  assert.ok(!/trust|threat|affinity|soul|hiddenElement/i.test(view), "no hidden-layer key on the player surface");
  const hidden = this.osSandbox!.engine.events.query().filter((e) => e.hidden).map((e) => e.content);
  for (const h of hidden) assert.ok(!this.osPlayerRumor!.content.includes(h), "the rumor is a paraphrase, never the verbatim scene");
});

// --- 0038 Scenario: off-screen scenes deepen the souls ------------------------------------

When("the off-screen society runs several ticks", function (this: BbWorld) {
  for (let t = 0; t < 8; t++) assert.equal(this.osOrch!.advance(this.osUser!, "offscreen-tick").integrity, "ok");
});

Then("each houseguest's soul accumulates the off-screen scenes it lived", function (this: BbWorld) {
  const core = this.osSandbox!.session.snapshot();
  const deepened = core.house!.npcs.filter((n) => n.soul.memory.length > 0);
  assert.ok(deepened.length > 0, "off-screen life deepened the souls");
});

Then("a later recall can surface a specific past off-screen moment", function (this: BbWorld) {
  const core = this.osSandbox!.session.snapshot();
  const someone = core.house!.npcs.find((n) => n.soul.memory.length > 0)!;
  // Recall must genuinely RETURN the recorded off-screen content — not merely "answer" (T3). Query
  // the soul index with a specific lived note and assert that exact past moment comes back.
  const target = someone.soul.memory[0]!;
  const recalled = this.osSandbox!.engine.soul.recall(someone.id, target, 3);
  assert.ok(recalled.length >= 1, "the recall index surfaces at least one lived off-screen moment");
  assert.ok(
    recalled.some((m) => m.content === target),
    "the specific off-screen note the houseguest lived is recallable by its own content",
  );
});

Then("no previously recorded soul detail is lost", function (this: BbWorld) {
  const before = this.osSandbox!.session.snapshot().house!.npcs.map((n) => n.soul.memory.length);
  this.osOrch!.advance(this.osUser!, "offscreen-tick");
  const after = this.osSandbox!.session.snapshot().house!.npcs.map((n) => n.soul.memory.length);
  for (let i = 0; i < before.length; i++) assert.ok(after[i]! >= before[i]!, "soul memory only accumulates");
});

// --- 0038 Scenario: bounded and deterministic ----------------------------------------------

Given("two games started from the same seed and left idle", function (this: BbWorld) {
  osGame(this, 33);
  this.osSandboxA = this.osSandbox; this.osOrchA = this.osOrch; this.osUserA = this.osUser;
  // The SAME user key + seed: the per-user rng streams must match for determinism.
  const reg = new GameSessionRegistry();
  const user = this.osUserA!;
  const orch = new Orchestrator(reg, { now: () => 33 }, { seed: 33 });
  const sb = reg.sandboxFor(user);
  sb.session.createCharacter({ playerName: "The Player", seed: 33 });
  this.osRegistry = reg; this.osUser = user; this.osSandbox = sb; this.osOrch = orch;
});

When("the same number of off-screen ticks is applied to each", function (this: BbWorld) {
  for (let t = 0; t < 6; t++) {
    this.osOrchA!.advance(this.osUserA!, "offscreen-tick");
    this.osOrch!.advance(this.osUser!, "offscreen-tick");
  }
});

Then("their resulting societies are identical", function (this: BbWorld) {
  const a = this.osSandboxA!.engine.events.query().filter((e) => e.hidden).map((e) => `${e.type}:${e.content}`);
  const b = this.osSandbox!.engine.events.query().filter((e) => e.hidden).map((e) => `${e.type}:${e.content}`);
  assert.deepEqual(a, b, "same seed ⇒ the same hidden society");
});

Then("a long absence advances at most the configured number of ticks per wake", function (this: BbWorld) {
  // T11: the per-wake cap bounds TICKS, so assert the TICK COUNT directly — not a padded event
  // bound. The old `grown <= 2*10` hid a ×10 fudge: one tick emits a VARIABLE number of scenes,
  // so an event count can never pin the cap. Spy the orchestrator's `advance` to count the
  // off-screen ticks the watcher actually fires in one wake, and assert it is EXACTLY the
  // configured `maxOffscreenTicksPerWake` — no more (the cap), and (for a started, idle game)
  // no fewer.
  const MAX = 2;
  const clock = new FakeClock();
  const registry = new GameSessionRegistry();
  const orch = new Orchestrator(registry, clock, { seed: 33 });
  let offscreenTicks = 0;
  const realAdvance = orch.advance.bind(orch);
  orch.advance = (user, trigger, opts) => {
    if (trigger === "offscreen-tick") offscreenTicks++;
    return realAdvance(user, trigger, opts);
  };
  const watcher = new GameWatcher(registry, orch, clock, clock, {
    tickEveryMs: 1000, idleTickAfterMs: 1000, maxOffscreenTicksPerWake: MAX, auditEveryMs: 0,
  });
  registry.sandboxFor("os-cap").session.createCharacter({ playerName: "The Player", seed: 33 });
  orch.touch("os-cap");
  watcher.start();
  clock.advance(1000); // ONE wake after a "long" absence
  watcher.stop();
  assert.equal(offscreenTicks, MAX, `the wake fires exactly maxOffscreenTicksPerWake ticks (was ${offscreenTicks})`);
});

// --- 0038 Scenario: Vault-free and isolated --------------------------------------------------

Given("two users each have their own idle game whose Vault holds hidden scheming", function (this: BbWorld) {
  const reg = new GameSessionRegistry();
  const orch = new Orchestrator(reg, { now: () => 44 }, { seed: 44 });
  const a = reg.sandboxFor("os-iso-a");
  const b = reg.sandboxFor("os-iso-b");
  a.session.createCharacter({ playerName: "The Player", seed: 44 });
  b.session.createCharacter({ playerName: "The Player", seed: 45 });
  // T11: plant a UNIQUE hidden sentinel in each game's Vault + a houseguest's knowledge, so the
  // Then can prove genuine content/knowledge cross-absence — a distinctive marker can't collide
  // across stores the way generic templated scene text can.
  this.osSentinelA = "ISO-SENTINEL-A-7f3";
  this.osSentinelB = "ISO-SENTINEL-B-9k2";
  a.engine.vault.writeHidden({ id: "iso:a", kind: "hidden-thread", content: `secret scheme ${this.osSentinelA}` });
  b.engine.vault.writeHidden({ id: "iso:b", kind: "hidden-thread", content: `secret scheme ${this.osSentinelB}` });
  a.engine.knowledge.seedBelief(npc(1), { content: `a houseguest knows ${this.osSentinelA}`, factId: "iso-fact-a" }, "witnessed");
  b.engine.knowledge.seedBelief(npc(1), { content: `a houseguest knows ${this.osSentinelB}`, factId: "iso-fact-b" }, "witnessed");
  this.osRegistry = reg; this.osOrch = orch;
  this.osSandboxA = a; this.osSandbox = b;
  this.osUserA = "os-iso-a"; this.osUser = "os-iso-b";
});

When("the off-screen society runs across both", function (this: BbWorld) {
  for (let t = 0; t < 6; t++) {
    this.osOrch!.advance(this.osUserA!, "offscreen-tick");
    this.osOrch!.advance(this.osUser!, "offscreen-tick");
  }
});

Then("no player surface reveals a hidden scene or an opinion number", function (this: BbWorld) {
  for (const sb of [this.osSandboxA!, this.osSandbox!]) {
    const view = JSON.stringify(sb.session.getGameState()) + "\n" + JSON.stringify(sb.player.getVisibleState());
    const hidden = sb.engine.events.query().filter((e) => e.hidden).map((e) => e.content);
    for (const h of hidden) assert.ok(!view.includes(h), "no verbatim hidden scene on a player surface");
    assert.ok(!/trust|threat|affinity|soul/i.test(view), "no opinion number");
  }
});

Then("no off-screen activity carries one user's content into the other's game", function (this: BbWorld) {
  // T11: prove CONTENT/KNOWLEDGE cross-absence — that the absent party genuinely cannot ACCESS the
  // other user's off-screen life — not merely disjoint id-sets (disjoint by construction). Each
  // game planted a UNIQUE hidden sentinel in its Vault + a houseguest's knowledge (the Given);
  // after both ran their off-screen society, that sentinel must be entirely unreachable from the
  // other game — in its full event/knowledge record AND on its player surface.
  const a = this.osSandboxA!; const b = this.osSandbox!;
  assert.notEqual(a.engine.events, b.engine.events, "separate event stores (0021)");
  assert.notEqual(a.engine.knowledge, b.engine.knowledge, "separate knowledge graphs (0021)");

  const recordAndKnowledgeOf = (sb: typeof a): string => {
    const core = sb.session.snapshot();
    const ids = [core.house!.player.id, ...core.house!.npcs.map((n) => n.id)];
    const known = ids.flatMap((id) => sb.engine.knowledge.knownTo(id).map((k) => `${k.content}|${k.originalContent ?? ""}`));
    return JSON.stringify(sb.engine.events.query()) + "\n" + known.join("\n");
  };
  const surfaceOf = (sb: typeof a): string =>
    JSON.stringify(sb.session.getGameState()) + "\n" + JSON.stringify(sb.player.getVisibleState());

  // Each game holds its OWN sentinel in its hidden layer (sanity: the marker really is in A/B).
  assert.ok(recordAndKnowledgeOf(a).includes(this.osSentinelA!), "user A holds its own hidden sentinel");
  assert.ok(recordAndKnowledgeOf(b).includes(this.osSentinelB!), "user B holds its own hidden sentinel");

  // ...and NEITHER game's record/knowledge nor player surface can reach the OTHER's sentinel.
  const aReach = recordAndKnowledgeOf(a) + "\n" + surfaceOf(a);
  const bReach = recordAndKnowledgeOf(b) + "\n" + surfaceOf(b);
  assert.ok(!bReach.includes(this.osSentinelA!), "user A's hidden content/knowledge never reaches user B");
  assert.ok(!aReach.includes(this.osSentinelB!), "user B's hidden content/knowledge never reaches user A");
});

// --- 0035 scenarios ----------------------------------------------------------------------------

Given("the engine runtime is composed", function (this: BbWorld) {
  this.osRuntime = composeRuntime();
});

Then("a watcher is instantiated over the session registry with a real-timer clock", function (this: BbWorld) {
  assert.ok(this.osRuntime!.watcher, "the watcher exists");
  assert.ok(this.osRuntime!.clock instanceof SystemClock, "a real-timer clock by default");
});

Then("it is started, and stops cleanly on shutdown", function (this: BbWorld) {
  // T11: kill the vacuous `assert.ok(true)`. "Stops cleanly" means: after stop the watcher
  // holds no live timer and a redundant stop is a harmless no-op (a dangling/double-cancel
  // handle would throw). Drive it on a FAKE clock so we can prove no callback survives the
  // stop — once stopped, advancing the clock past the cadence fires nothing more.
  const clock = new FakeClock();
  const registry = new GameSessionRegistry();
  const orch = new Orchestrator(registry, clock, { seed: 9 });
  let ticks = 0;
  const realAdvance = orch.advance.bind(orch);
  orch.advance = (user, trigger, opts) => {
    if (trigger === "offscreen-tick") ticks++;
    return realAdvance(user, trigger, opts);
  };
  const watcher = new GameWatcher(registry, orch, clock, clock, {
    tickEveryMs: 1000, idleTickAfterMs: 1, maxOffscreenTicksPerWake: 1, auditEveryMs: 0,
  });
  registry.sandboxFor("os-stop").session.createCharacter({ playerName: "The Player", seed: 9 });
  orch.touch("os-stop");
  watcher.start();
  clock.advance(1000); // one wake while running
  const ranWhileLive = ticks;
  assert.ok(ranWhileLive > 0, "the started watcher actually ticks");
  watcher.stop();
  clock.advance(10_000); // long after shutdown — a dangling timer would tick here
  assert.equal(ticks, ranWhileLive, "no off-screen tick fires after a clean stop");
  assert.doesNotThrow(() => watcher.stop(), "a redundant stop is a harmless no-op");
  // The composed runtime's own start/stop must also be dangling-free (the suite hangs otherwise).
  this.osRuntime!.start();
  this.osRuntime!.stop();
});





Given("a started game left idle for a long stretch", function (this: BbWorld) {
  const clock = new FakeClock();
  const rt = composeRuntime({ clock, watcher: { tickEveryMs: 1000, idleTickAfterMs: 1000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 } });
  rt.registry.sandboxFor("os-long").session.createCharacter({ playerName: "The Player", seed: 5 });
  rt.orchestrator.touch("os-long");
  // T11: spy the runtime's orchestrator so the Then can assert the TICK COUNT the watcher fires
  // in one wake — not an event bound padded by a ×10 fudge.
  const counter = { n: 0 };
  const realAdvance = rt.orchestrator.advance.bind(rt.orchestrator);
  rt.orchestrator.advance = (user, trigger, opts) => {
    if (trigger === "offscreen-tick") counter.n++;
    return realAdvance(user, trigger, opts);
  };
  this.osTickCount = counter;
  this.osRuntime2 = rt; this.osClock = clock;
});

When("the watcher wakes", function (this: BbWorld) {
  this.osHiddenBefore = this.osRuntime2!.registry.sandboxFor("os-long").engine.events.query().filter((e) => e.hidden).length;
  this.osRuntime2!.start();
  this.osClock!.advance(1000); // ONE wake — however long the absence was
  this.osRuntime2!.stop();
});

Then("it advances the game at most the configured number of off-screen ticks", function (this: BbWorld) {
  // T11: assert the TICK COUNT directly. One wake fires exactly maxOffscreenTicksPerWake (3)
  // off-screen ticks — the per-wake cap, proven on the count, never on a padded event total.
  assert.equal(this.osTickCount!.n, 3, `one wake fires exactly maxOffscreenTicksPerWake ticks (was ${this.osTickCount!.n})`);
  // And the souls genuinely deepened across those bounded ticks (the ticks did real work).
  const grown = this.osRuntime2!.registry.sandboxFor("os-long").engine.events.query().filter((e) => e.hidden).length - this.osHiddenBefore!;
  assert.ok(grown > 0, "the bounded ticks produced real off-screen life");
});

Then("it does not fast-forward the season", function (this: BbWorld) {
  const core = this.osRuntime2!.registry.sandboxFor("os-long").session.snapshot();
  assert.equal(core.week, 1, "the WEEK is the player's clock — off-screen life never advances it");
});

Given("two users each have their own idle game", function (this: BbWorld) {
  // The shared audit When (game_orchestrator.steps) drives this.registry with user-a/user-b.
  this.registry = new GameSessionRegistry();
  this.registry.sandboxFor("user-a").session.createCharacter({ playerName: "The Player", seed: 1 });
  this.registry.sandboxFor("user-b").session.createCharacter({ playerName: "The Player", seed: 2 });
});


Then("no off-screen advance carries one user's content into the other's game", function (this: BbWorld) {
  // T11: prove CONTENT/KNOWLEDGE cross-absence (not just disjoint id-sets). The shared audit When
  // planted a per-user MARKER then ran real off-screen ticks on both sandboxes. Assert: (a) each
  // user's distinctive marker stays home and never reaches the other; (b) no knowledge fact crosses
  // between the two games' knowledge graphs. (We don't string-compare generic templated scene text
  // across stores — it shares the npc:1..15 id space and can collide by coincidence, which is
  // template reuse, not a leak; the marker + knowledge checks are the real access guarantees.)
  const a = this.registry!.sandboxFor("user-a");
  const b = this.registry!.sandboxFor("user-b");
  assert.notEqual(a.engine.events, b.engine.events, "separate object graphs (0021)");
  assert.notEqual(a.engine.knowledge, b.engine.knowledge, "separate knowledge graphs (0021)");

  const recordOf = (sb: typeof a): string => {
    const core = sb.session.snapshot();
    const ids = [core.house!.player.id, ...core.house!.npcs.map((n) => n.id)];
    const known = ids.flatMap((id) => sb.engine.knowledge.knownTo(id).map((k) => k.content));
    return JSON.stringify(sb.engine.events.query()) + "\n" + known.join("\n");
  };
  const aRecord = recordOf(a); const bRecord = recordOf(b);

  // The distinctive per-user markers (event content AND, by the recordOf, any knowledge derived
  // from them) stay home — neither user's unique marker is reachable from the other's full record.
  assert.ok(aRecord.includes("MARKER-A-7f3") && !aRecord.includes("MARKER-B-9k2"), "user A keeps only its own content");
  assert.ok(bRecord.includes("MARKER-B-9k2") && !bRecord.includes("MARKER-A-7f3"), "user B keeps only its own content");
  // And neither marker leaks onto the OTHER user's player surface either.
  const surfaceOf = (sb: typeof a): string =>
    JSON.stringify(sb.session.getGameState()) + "\n" + JSON.stringify(sb.player.getVisibleState());
  assert.ok(!surfaceOf(b).includes("MARKER-A-7f3"), "user A's content never surfaces in user B");
  assert.ok(!surfaceOf(a).includes("MARKER-B-9k2"), "user B's content never surfaces in user A");
});

Given("the watcher cadence is configured to zero", function (this: BbWorld) {
  const clock = new FakeClock();
  this.osRuntime2 = composeRuntime({ clock, watcher: { tickEveryMs: 0, idleTickAfterMs: 1, maxOffscreenTicksPerWake: 9, auditEveryMs: 0 } });
  this.osClock = clock;
  this.osRuntime2.registry.sandboxFor("os-zero").session.createCharacter({ playerName: "The Player", seed: 8 });
});

When("time passes with the player idle", function (this: BbWorld) {
  this.osHiddenBefore = this.osRuntime2!.registry.sandboxFor("os-zero").engine.events.query().length;
  this.osRuntime2!.start();
  this.osClock!.advance(1_000_000);
  this.osRuntime2!.stop();
});

Then("no game advances on its own", function (this: BbWorld) {
  const now = this.osRuntime2!.registry.sandboxFor("os-zero").engine.events.query().length;
  assert.equal(now, this.osHiddenBefore, "pure turn-driven: the house does not exist while the player is away");
});

Then("the game advances only when the player takes a turn", function (this: BbWorld) {
  const sb = this.osRuntime2!.registry.sandboxFor("os-zero");
  const before = sb.engine.events.query().length;
  sb.session.advanceGame(); // a player turn
  assert.ok(sb.engine.events.query().length > before, "the player's own turn moves the game");
});
