import { Given, When, Then } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BbWorld } from "../support/world";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { UserSandbox } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import type { HealthRecord } from "../../src/composition/orchestrator";
import { GameWatcher } from "../../src/composition/gameWatcher";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

// Reuses: "a started game" (moment_orchestration — registry + orchestrator + gsView) and
// "two users each have their own in-progress game" (durable_persistence, users user-a/user-b).

const newDir = (): string => mkdtempSync(join(tmpdir(), "orwell-0031-"));
const U = "user-a";

const hiddenOf = (sb: UserSandbox): string[] => sb.engine.events.query().filter((e) => e.hidden).map((e) => e.content);
const playerSweep = (sb: UserSandbox): string =>
  [sb.player.produce("player-visible log"), sb.player.produce("scene narration"), JSON.stringify(sb.player.getVisibleState())].join("\n");

// --- S1: a turn-driven advance ------------------------------------------------

When("the player triggers an advance", function (this: BbWorld) {
  this.hiddenBefore = hiddenOf(this.registry!.sandboxFor(U)).length;
  this.advanceResult = this.orchestrator!.advance(U, "player-turn");
});

Then("the day carries at least one meaningful event", function (this: BbWorld) {
  const witnessed = this.registry!.sandboxFor(U).engine.events.query({ witnessedBy: PLAYER });
  assert.ok(witnessed.some((e) => e.type === "house-event"), "a meaningful player-witnessed event"); // E58: the day event is typed; its content varies by design
});

Then("at least one off-screen scene occurs that the player does not witness", function (this: BbWorld) {
  assert.ok(hiddenOf(this.registry!.sandboxFor(U)).length > (this.hiddenBefore ?? 0));
});

Then("the integrity checkpoint passes", function (this: BbWorld) {
  assert.equal(this.advanceResult!.integrity, "ok");
});

Then("the new state is persisted", function (this: BbWorld) {
  const saved = new FileSaveStore(this.saveDir!).loadLatest(U);
  assert.ok(saved && saved.events.length > 0, "the advance was saved");
});

// --- S2: the house lives between turns ----------------------------------------

Given("a started game that the player has left idle", function (this: BbWorld) {
  this.saveDir = newDir();
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  this.fakeClock = new FakeClock();
  this.orchestrator = new Orchestrator(this.registry, this.fakeClock, { seed: 3 });
  this.watcher = new GameWatcher(this.registry, this.orchestrator, this.fakeClock, this.fakeClock, {
    tickEveryMs: 1000, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0,
  });
  this.registry.sandboxFor(U).session.createCharacter({ playerName: "Idle", seed: 3 });
  this.orchestrator.touch(U); // the player's last activity is now (t0)
});

When("the clock advances past the idle threshold", function (this: BbWorld) {
  this.hiddenBefore = hiddenOf(this.registry!.sandboxFor(U)).length;
  this.watcher!.start();
  this.fakeClock!.advance(6000);
});

Then("the watcher triggers bounded off-screen advances for that game", function (this: BbWorld) {
  assert.ok(hiddenOf(this.registry!.sandboxFor(U)).length > this.hiddenBefore!, "off-screen events accrued");
});

Then("on the player's return there are new off-screen consequences", function (this: BbWorld) {
  assert.ok(hiddenOf(this.registry!.sandboxFor(U)).length > this.hiddenBefore!);
});

Then("the player is shown no opinion numbers or hidden state", function (this: BbWorld) {
  const sb = this.registry!.sandboxFor(U);
  const view = playerSweep(sb);
  for (const c of hiddenOf(sb)) assert.ok(!view.includes(c), "no hidden/off-screen content surfaces");
});

// --- S3: the integrity checkpoint is fail-closed ------------------------------

Given("a started game with recorded events, beliefs, and deepened souls", function (this: BbWorld) {
  this.saveDir = newDir();
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  this.fakeClock = new FakeClock();
  this.durableSentinel = "LEAK-0031-SENTINEL";
  const leak = this.durableSentinel;
  // An advance that LEAKS: the same secret appears hidden AND in a witnessed event.
  const leakingApply = (sb: UserSandbox): number => {
    sb.engine.events.record({ id: "leak:h", ts: 1, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: `secret ${leak}` });
    sb.engine.events.record({ id: "leak:v", ts: 2, type: "conversation", initiator: npc(1), witnessSet: [PLAYER, npc(1)], hidden: false, content: `secret ${leak}` });
    return 1;
  };
  this.orchestrator = new Orchestrator(this.registry, this.fakeClock, { seed: 1, apply: leakingApply });
  const sb = this.registry.sandboxFor(U);
  sb.session.createCharacter({ playerName: "Keeper", seed: 1 });
  // Pre-existing detail (events + a belief) that must survive a refused advance.
  sb.engine.events.record({ id: "pre1", ts: 0, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: "a prior scheme" });
  sb.engine.relationships.applyDirected(npc(2), npc(1), "betrayal", new SeededRandom(1));
  this.registry.saveUser(U);
});

When("an advance would drop previously persisted detail or leak hidden state", function (this: BbWorld) {
  this.advanceResult = this.orchestrator!.advance(U, "player-turn");
});

Then("the checkpoint refuses to commit the advance", function (this: BbWorld) {
  assert.equal(this.advanceResult!.integrity, "fault");
});

Then("the prior persisted save is left intact", function (this: BbWorld) {
  const saved = new FileSaveStore(this.saveDir!).loadLatest(U)!;
  assert.ok(!JSON.stringify(saved.events).includes(this.durableSentinel!), "the leak was never persisted");
  assert.ok(saved.events.some((e) => e.id === "pre1"), "prior detail is intact");
});

Then("an integrity fault is recorded on that sandbox's health", function (this: BbWorld) {
  const health = this.orchestrator!.sandboxHealth(U) as HealthRecord;
  assert.equal(health.lastIntegrity, "fault");
  assert.ok(health.faults.length >= 1);
});

// --- S4: the watcher is deterministic and holds no game logic -----------------

/** T17: one fully-wired game (registry + orchestrator + WATCHER on a fake clock), un-ticked. */
interface TickedRun {
  reg: GameSessionRegistry;
  clock: FakeClock;
  watcher: GameWatcher;
}
let tickedRunA: TickedRun | undefined;
let tickedRunB: TickedRun | undefined;

Given("two games started from the same seed", function (this: BbWorld) {
  // T17: the Given only STARTS the two same-seed games; the When (previously an empty step)
  // is what applies the identical clock-tick sequence through the real watcher seam.
  const mk = (): TickedRun => {
    const reg = new GameSessionRegistry();
    const clock = new FakeClock();
    const orch = new Orchestrator(reg, clock, { seed: 42 });
    const watcher = new GameWatcher(reg, orch, clock, clock, {
      tickEveryMs: 1000, idleTickAfterMs: 0, maxOffscreenTicksPerWake: 2, auditEveryMs: 2000,
    });
    reg.sandboxFor(U).session.createCharacter({ playerName: "Same", seed: 42 });
    orch.touch(U);
    return { reg, clock, watcher };
  };
  tickedRunA = mk();
  tickedRunB = mk();
});

When("the same sequence of clock ticks is applied to each", function (this: BbWorld) {
  // The SAME tick sequence, driven through the running watcher on each game's fake clock —
  // the watcher's off-screen advances (and audits) are what the ticks trigger.
  const ticks = [1000, 1000, 500, 1500, 1000, 3000];
  const apply = (run: TickedRun): string => {
    const before = run.reg.sandboxFor(U).engine.events.query().length;
    run.watcher.start();
    for (const ms of ticks) run.clock.advance(ms);
    run.watcher.stop();
    // The ticks genuinely advanced the game — the comparison below is not vacuous.
    assert.ok(run.reg.sandboxFor(U).engine.events.query().length > before, "the clock ticks advanced the game");
    const s = run.reg.snapshot(U);
    return JSON.stringify({ events: s.events, relationships: s.relationships });
  };
  this.stateA = apply(tickedRunA!);
  this.stateB = apply(tickedRunB!);
});

Then("their resulting states are identical", function (this: BbWorld) {
  assert.equal(this.stateA, this.stateB);
});

Then("disabling the watcher leaves games that never advance on their own", function () {
  const reg = new GameSessionRegistry();
  const clock = new FakeClock();
  const orch = new Orchestrator(reg, clock, { seed: 1 });
  const watcher = new GameWatcher(reg, orch, clock, clock, {
    tickEveryMs: 0, idleTickAfterMs: 1, maxOffscreenTicksPerWake: 5, auditEveryMs: 0,
  });
  reg.sandboxFor(U).session.createCharacter({ playerName: "Still", seed: 1 });
  const before = reg.sandboxFor(U).engine.events.query().length;
  watcher.start();
  clock.advance(100_000);
  assert.equal(reg.sandboxFor(U).engine.events.query().length, before, "a disabled watcher never self-advances");
});

// --- S5: isolation holds while the watcher audits many sandboxes --------------
// (Given "two users each have their own in-progress game" → durable_persistence.steps.)

When("the watcher ticks and audits across all sandboxes", function (this: BbWorld) {
  const clock = new FakeClock();
  this.orchestrator = new Orchestrator(this.registry!, clock, { seed: 5 });
  this.watcher = new GameWatcher(this.registry!, this.orchestrator, clock, clock, {
    tickEveryMs: 1000, idleTickAfterMs: 0, maxOffscreenTicksPerWake: 2, auditEveryMs: 1000,
  });
  this.registry!.sandboxFor("user-a").engine.events.record({ id: "mk-a", ts: 0, type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "MARKER-A-7f3" });
  this.registry!.sandboxFor("user-b").engine.events.record({ id: "mk-b", ts: 0, type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "MARKER-B-9k2" });
  this.watcher.start();
  clock.advance(3000);
});

Then("no advance or audit carries one user's content into the other's game", function (this: BbWorld) {
  const a = JSON.stringify(this.registry!.sandboxFor("user-a").engine.events.query());
  const b = JSON.stringify(this.registry!.sandboxFor("user-b").engine.events.query());
  assert.ok(a.includes("MARKER-A-7f3") && !a.includes("MARKER-B-9k2"), "user A keeps only its own content");
  assert.ok(b.includes("MARKER-B-9k2") && !b.includes("MARKER-A-7f3"), "user B keeps only its own content");
});

// --- S6: sandbox health is God-Mode-only and Vault-free -----------------------

Given("a started game whose Vault holds off-screen scheming and hidden attributes", function (this: BbWorld) {
  this.saveDir = newDir();
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  this.fakeClock = new FakeClock();
  this.orchestrator = new Orchestrator(this.registry, this.fakeClock, { seed: 9 });
  this.durableSentinel = "VAULT-0031-SENTINEL";
  const sb = this.registry.sandboxFor(U);
  sb.session.createCharacter({ playerName: "Watched", seed: 9 });
  sb.engine.vault.writeHidden({ id: "v1", kind: "hidden-attribute", content: `hidden ${this.durableSentinel}` });
  this.orchestrator.advance(U, "player-turn"); // produces off-screen hidden events too
});

When("God Mode reads that sandbox's health", function (this: BbWorld) {
  this.health = this.orchestrator!.sandboxHealth(U) as HealthRecord;
});

// NOTE: the literal "(" is escaped — an unescaped "(...)" is a Cucumber optional group.
Then("it returns only metadata \\(phase, counts, last advance, integrity status, faults)", function (this: BbWorld) {
  assert.deepEqual(
    Object.keys(this.health!).sort(),
    ["circuitOpen", "eventCount", "faults", "lastAdvanceAt", "lastIntegrity", "lastTrigger", "phase", "started", "user", "week"],
  );
});

Then("it returns no Vault data and no other user's content", function (this: BbWorld) {
  const json = JSON.stringify(this.health);
  assert.ok(!json.includes(this.durableSentinel!), "no Vault sentinel in health");
  for (const c of hiddenOf(this.registry!.sandboxFor(U))) assert.ok(!json.includes(c), "no off-screen content in health");
});

Then("the player has no access to the health surface", function (this: BbWorld) {
  const player = this.registry!.sandboxFor(U).player as unknown as Record<string, unknown>;
  assert.equal(typeof player["sandboxHealth"], "undefined");
});
