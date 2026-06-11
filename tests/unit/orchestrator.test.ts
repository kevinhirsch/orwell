import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameSessionRegistry } from "../../src/composition/registry";
import type { UserSandbox } from "../../src/composition/registry";
import { Orchestrator } from "../../src/composition/orchestrator";
import { GameWatcher } from "../../src/composition/gameWatcher";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";
import { PLAYER, npc } from "../../src/domain/ids";

const freshDir = (): string => mkdtempSync(join(tmpdir(), "orwell-0031-"));
const U = "user-a";

function hidden(sb: UserSandbox): string[] {
  return sb.engine.events.query().filter((e) => e.hidden).map((e) => e.content);
}
function playerSweep(sb: UserSandbox): string {
  const p = sb.player;
  return [p.produce("player-visible log"), p.produce("scene narration"), JSON.stringify(p.getVisibleState())].join("\n");
}

describe("0031 — game orchestrator & integrity watcher", () => {
  it("a turn-driven advance runs off-screen life and passes the integrity checkpoint", () => {
    const dir = freshDir();
    const registry = new GameSessionRegistry(new FileSaveStore(dir));
    const orch = new Orchestrator(registry, new FakeClock(), { seed: 7 });
    registry.sandboxFor(U).session.createCharacter({ playerName: "Player One", seed: 7 });
    const savedBefore = new FileSaveStore(dir).loadLatest(U)!.events.length;

    const res = orch.advance(U, "player-turn");
    expect(res.integrity).toBe("ok");
    expect(res.events).toBeGreaterThanOrEqual(1);

    const sb = registry.sandboxFor(U);
    // A meaningful, player-witnessed day event (daily-event invariant).
    expect(sb.engine.events.query({ witnessedBy: PLAYER }).some((e) => e.type === "house-event")).toBe(true); // E58: content now varies — assert the typed day event, not one canned line
    // At least one off-screen scene the player does not witness.
    expect(hidden(sb).length).toBeGreaterThanOrEqual(1);
    // The new state is persisted (a later save with more events).
    expect(new FileSaveStore(dir).loadLatest(U)!.events.length).toBeGreaterThan(savedBefore);
  });

  it("the house lives between turns: idle off-screen ticks, no numbers shown", () => {
    const registry = new GameSessionRegistry(new FileSaveStore(freshDir()));
    const clock = new FakeClock();
    const orch = new Orchestrator(registry, clock, { seed: 3 });
    const watcher = new GameWatcher(registry, orch, clock, clock, {
      tickEveryMs: 1000, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0,
    });
    registry.sandboxFor(U).session.createCharacter({ playerName: "Idle", seed: 3 });
    orch.touch(U); // the player's last activity is now (t0)
    const before = hidden(registry.sandboxFor(U)).length;

    watcher.start();
    clock.advance(6000); // past the idle threshold — the watcher ticks fire

    const sb = registry.sandboxFor(U);
    expect(hidden(sb).length).toBeGreaterThan(before); // new off-screen consequences
    // The player is shown no hidden/off-screen content (no opinion numbers, no Vault).
    const view = playerSweep(sb);
    for (const c of hidden(sb)) expect(view.includes(c)).toBe(false);
  });

  it("the integrity checkpoint is fail-closed (no degradation, no leak)", () => {
    const dir = freshDir();
    const registry = new GameSessionRegistry(new FileSaveStore(dir));
    const clock = new FakeClock();
    const LEAK = "LEAK-0031-SENTINEL";
    // An advance that LEAKS: the same secret appears hidden AND in a player-witnessed event.
    const leakingApply = (sb: UserSandbox): number => {
      sb.engine.events.record({ id: "leak:h", ts: 1, type: "conversation", initiator: npc(1), witnessSet: [npc(1), npc(2)], hidden: true, content: `secret ${LEAK}` });
      sb.engine.events.record({ id: "leak:v", ts: 2, type: "conversation", initiator: npc(1), witnessSet: [PLAYER, npc(1)], hidden: false, content: `secret ${LEAK}` });
      return 1;
    };
    const orch = new Orchestrator(registry, clock, { seed: 1, apply: leakingApply });
    registry.sandboxFor(U).session.createCharacter({ playerName: "Keeper", seed: 1 });
    const savedBefore = new FileSaveStore(dir).loadLatest(U)!;

    const res = orch.advance(U, "player-turn");
    expect(res.integrity).toBe("fault");
    expect(res.faults.some((f) => f.kind === "vault-leak")).toBe(true);

    // The prior persisted save is intact (the leak was never committed)...
    const savedAfter = new FileSaveStore(dir).loadLatest(U)!;
    expect(savedAfter.events.length).toBe(savedBefore.events.length);
    expect(JSON.stringify(savedAfter.events).includes(LEAK)).toBe(false);
    // ...and the live sandbox was rolled back (clean — no aborted events).
    expect(registry.sandboxFor(U).engine.events.query().some((e) => e.content.includes(LEAK))).toBe(false);
    // A fault is recorded on the sandbox's health.
    const health = orch.sandboxHealth(U) as { lastIntegrity: string; faults: unknown[] };
    expect(health.lastIntegrity).toBe("fault");
    expect(health.faults.length).toBeGreaterThanOrEqual(1);
  });

  it("an off-screen tick with fewer than two living NPCs is a clean no-op, not a fault (deep endgame)", () => {
    const registry = new GameSessionRegistry();
    const orch = new Orchestrator(registry, new FakeClock(), { seed: 13 });
    registry.sandboxFor(U).session.createCharacter({ playerName: "Finalist", seed: 13 });
    // The player stands in the Final 2: every NPC but one has been evicted (B52: evictees stop
    // living), so there is no off-screen society left to run. The tick must be a clean no-op —
    // the old behavior logged a no-daily-event integrity fault on every finale turn.
    const snap = registry.snapshot(U);
    const npcs = snap.house!.npcs.map((n) => n.id);
    snap.live!.evictionOrder = npcs.slice(0, npcs.length - 1);
    snap.live!.active = [PLAYER, npcs[npcs.length - 1]!];
    registry.restore(U, snap);
    const before = registry.sandboxFor(U).engine.events.query().length;

    const res = orch.advance(U, "offscreen-tick");
    expect(res.integrity).toBe("ok");
    expect(res.faults).toEqual([]);
    expect(res.events).toBe(0);
    expect(registry.sandboxFor(U).engine.events.query().length).toBe(before);
    expect((orch.sandboxHealth(U) as { lastIntegrity: string }).lastIntegrity).not.toBe("fault");
  });

  it("the checkpoint detects dropped detail (degradation)", () => {
    const registry = new GameSessionRegistry();
    const orch = new Orchestrator(registry, new FakeClock(), { seed: 1 });
    registry.sandboxFor(U).session.createCharacter({ playerName: "P", seed: 1 });
    orch.advance(U, "player-turn"); // populate some persisted detail
    const baseline = registry.snapshot(U);
    expect(baseline.events.length).toBeGreaterThan(0);
    const degraded = { ...baseline, events: [] }; // dropped every persisted event
    const faults = orch.checkpoint(baseline, degraded, registry.sandboxFor(U), "player-turn");
    expect(faults.some((f) => f.kind === "degradation")).toBe(true);
  });

  it("the watcher is deterministic and holds no game logic", () => {
    const runGame = (seed: number): string => {
      const registry = new GameSessionRegistry();
      const orch = new Orchestrator(registry, new FakeClock(), { seed });
      registry.sandboxFor(U).session.createCharacter({ playerName: "Same", seed });
      for (let i = 0; i < 3; i++) orch.advance(U, "player-turn");
      const snap = registry.snapshot(U);
      return JSON.stringify({ events: snap.events, relationships: snap.relationships });
    };
    expect(runGame(42)).toBe(runGame(42)); // same seed + same ticks ⇒ identical state

    // Disabling the watcher (cadence 0) ⇒ games never advance on their own.
    const registry = new GameSessionRegistry();
    const clock = new FakeClock();
    const orch = new Orchestrator(registry, clock, { seed: 1 });
    const watcher = new GameWatcher(registry, orch, clock, clock, {
      tickEveryMs: 0, idleTickAfterMs: 1, maxOffscreenTicksPerWake: 5, auditEveryMs: 0,
    });
    registry.sandboxFor(U).session.createCharacter({ playerName: "Still", seed: 1 });
    const before = registry.sandboxFor(U).engine.events.query().length;
    watcher.start();
    clock.advance(100_000);
    expect(registry.sandboxFor(U).engine.events.query().length).toBe(before);
  });

  it("isolation holds while the watcher audits many sandboxes", () => {
    const registry = new GameSessionRegistry(new FileSaveStore(freshDir()));
    const clock = new FakeClock();
    const orch = new Orchestrator(registry, clock, { seed: 5 });
    const watcher = new GameWatcher(registry, orch, clock, clock, {
      tickEveryMs: 1000, idleTickAfterMs: 0, maxOffscreenTicksPerWake: 2, auditEveryMs: 1000,
    });
    registry.sandboxFor("A").session.createCharacter({ playerName: "Alpha", seed: 11 });
    registry.sandboxFor("B").session.createCharacter({ playerName: "Bravo", seed: 22 });
    // A unique witnessed marker in each sandbox.
    registry.sandboxFor("A").engine.events.record({ id: "mk-a", ts: 0, type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "MARKER-A-7f3" });
    registry.sandboxFor("B").engine.events.record({ id: "mk-b", ts: 0, type: "house-event", initiator: PLAYER, witnessSet: [PLAYER], hidden: false, content: "MARKER-B-9k2" });

    watcher.start();
    clock.advance(3000); // ticks + audits across both sandboxes

    const aEvents = JSON.stringify(registry.sandboxFor("A").engine.events.query());
    const bEvents = JSON.stringify(registry.sandboxFor("B").engine.events.query());
    expect(aEvents.includes("MARKER-A-7f3")).toBe(true);
    expect(bEvents.includes("MARKER-B-9k2")).toBe(true);
    expect(aEvents.includes("MARKER-B-9k2")).toBe(false); // no cross-user content
    expect(bEvents.includes("MARKER-A-7f3")).toBe(false);
  });

  it("sandbox health is God-Mode-only metadata and is Vault-free", () => {
    const registry = new GameSessionRegistry(new FileSaveStore(freshDir()));
    const orch = new Orchestrator(registry, new FakeClock(), { seed: 9 });
    const sb = registry.sandboxFor(U);
    sb.session.createCharacter({ playerName: "Watched", seed: 9 });
    const SENT = "VAULT-0031-SENTINEL";
    sb.engine.vault.writeHidden({ id: "v1", kind: "hidden-attribute", content: `hidden ${SENT}` });
    orch.advance(U, "player-turn"); // produces off-screen hidden events

    const health = orch.sandboxHealth(U) as unknown as Record<string, unknown>;
    expect(Object.keys(health).sort()).toEqual(
      ["circuitOpen", "eventCount", "faults", "lastAdvanceAt", "lastIntegrity", "lastTrigger", "phase", "started", "user", "week"],
    );
    const json = JSON.stringify(health);
    expect(json.includes(SENT)).toBe(false); // no Vault data
    for (const c of hidden(sb)) expect(json.includes(c)).toBe(false); // no off-screen content
    // The player has no access to the health surface.
    expect((sb.player as unknown as Record<string, unknown>)["sandboxHealth"]).toBeUndefined();
  });
});
