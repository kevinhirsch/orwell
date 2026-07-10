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
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { SeededRandom } from "../../src/adapters/random/SeededRandom";
import { PLAYER, npc } from "../../src/domain/ids";

// Reuses: "a started game" (moment_orchestration — registry + orchestrator + gsView) and
// "two users each have their own in-progress game" (durable_persistence, users user-a/user-b).

const newDir = (): string => mkdtempSync(join(tmpdir(), "orwell-0031-"));
const U = "user-a";

const hiddenOf = (sb: UserSandbox): string[] => sb.engine.events.queryAll().filter((e) => e.hidden).map((e) => e.content);
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

// --- S2: the house lives between turns (turn-driven, no wall-clock watcher) ----

Given("a started game the player is actively playing", function (this: BbWorld) {
  this.saveDir = newDir();
  this.registry = new GameSessionRegistry(new FileSaveStore(this.saveDir));
  this.fakeClock = new FakeClock();
  // Turn-driven: the house lives ONLY on the player's play-clock — one bounded off-screen tick per
  // committed turn (real-time purge 2026-07-10; there is no wall-clock watcher).
  this.orchestrator = new Orchestrator(this.registry, this.fakeClock, { seed: 3, turnDriven: true });
  this.registry.sandboxFor(U).session.createCharacter({ playerName: "Idle", seed: 3 });
});

When("the player commits a turn", function (this: BbWorld) {
  this.hiddenBefore = hiddenOf(this.registry!.sandboxFor(U)).length;
  this.orchestrator!.commitPlayerTurn(U);
});

Then("that turn fires one bounded off-screen advance for that game", function (this: BbWorld) {
  assert.ok(hiddenOf(this.registry!.sandboxFor(U)).length > this.hiddenBefore!, "off-screen events accrued");
});

Then("on the next turn there are new off-screen consequences", function (this: BbWorld) {
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

// --- S4: off-screen life is deterministic and holds no game logic -------------

/** T17: one fully-wired turn-driven game (registry + orchestrator on a fake clock), un-committed. */
interface TickedRun {
  reg: GameSessionRegistry;
  orch: Orchestrator;
}
let tickedRunA: TickedRun | undefined;
let tickedRunB: TickedRun | undefined;

Given("two games started from the same seed", function (this: BbWorld) {
  // T17: the Given only STARTS the two same-seed games; the When applies the identical sequence of
  // committed player turns through the turn-driven orchestrator seam (each turn = one off-screen tick).
  const mk = (): TickedRun => {
    const reg = new GameSessionRegistry();
    const orch = new Orchestrator(reg, new FakeClock(), { seed: 42, turnDriven: true });
    reg.sandboxFor(U).session.createCharacter({ playerName: "Same", seed: 42 });
    return { reg, orch };
  };
  tickedRunA = mk();
  tickedRunB = mk();
});

When("the same sequence of committed turns is applied to each", function (this: BbWorld) {
  // The SAME number of committed player turns on each game — each fires one bounded off-screen tick.
  const apply = (run: TickedRun): string => {
    const before = run.reg.sandboxFor(U).engine.events.queryAll().length;
    for (let i = 0; i < 6; i++) run.orch.commitPlayerTurn(U);
    // The turns genuinely advanced the game — the comparison below is not vacuous.
    assert.ok(run.reg.sandboxFor(U).engine.events.queryAll().length > before, "the committed turns advanced the game");
    const s = run.reg.snapshot(U);
    return JSON.stringify({ events: s.events, relationships: s.relationships });
  };
  this.stateA = apply(tickedRunA!);
  this.stateB = apply(tickedRunB!);
});

Then("their resulting states are identical", function (this: BbWorld) {
  assert.equal(this.stateA, this.stateB);
});

Then("a game with no committed turn never advances on its own", function () {
  // Turn-driven OFF (the default) + no committed turn ⇒ nothing ever runs the house. There is no
  // wall-clock watcher and no real-world clock, so a game the player never touches simply sits still.
  const reg = new GameSessionRegistry();
  const orch = new Orchestrator(reg, new FakeClock(), { seed: 1 });
  reg.sandboxFor(U).session.createCharacter({ playerName: "Still", seed: 1 });
  const before = reg.sandboxFor(U).engine.events.queryAll().length;
  // Even committing a turn on a non-turn-driven orchestrator adds no off-screen life.
  orch.commitPlayerTurn(U);
  assert.equal(reg.sandboxFor(U).engine.events.queryAll().length, before, "an untouched game never self-advances");
});

// --- S5: isolation holds while the house lives between turns across sandboxes --
// (Given "two users each have their own in-progress game" → durable_persistence.steps.)

When("each user commits a turn in their own game", function (this: BbWorld) {
  this.orchestrator = new Orchestrator(this.registry!, new FakeClock(), { seed: 5, turnDriven: true });
  this.registry!.sandboxFor("user-a").engine.events.record({ id: "mk-a", ts: 0, type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "MARKER-A-7f3" });
  this.registry!.sandboxFor("user-b").engine.events.record({ id: "mk-b", ts: 0, type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "MARKER-B-9k2" });
  // Each user's own play-clock drives their own off-screen life — no cross-user bleed.
  this.orchestrator.commitPlayerTurn("user-a");
  this.orchestrator.commitPlayerTurn("user-b");
});

Then("no advance carries one user's content into the other's game", function (this: BbWorld) {
  const a = JSON.stringify(this.registry!.sandboxFor("user-a").engine.events.queryAll());
  const b = JSON.stringify(this.registry!.sandboxFor("user-b").engine.events.queryAll());
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
