import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeRuntime, watcherConfigFromEnv, DEFAULT_WATCHER } from "../../src/composition/runtime";
import { SystemClock } from "../../src/adapters/time/SystemClock";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";

// Feature 0035: the runtime actually composes + starts the background watcher over the registry.
// Behavior under a running watcher is driven by an injected FakeClock for determinism (no real timers).

const U = "user-a";
const hidden = (rt: ReturnType<typeof composeRuntime>, u: string): number =>
  rt.registry.sandboxFor(u).engine.events.query().filter((e) => e.hidden).length;

const startGame = (rt: ReturnType<typeof composeRuntime>, u: string): void => {
  rt.registry.sandboxFor(u).session.createCharacter({ playerName: "P", seed: 7 });
  rt.orchestrator.touch(u); // last activity = now
};

describe("composeRuntime (feature 0035 — start the watcher in the runtime)", () => {
  it("defaults to a real-timer SystemClock", () => {
    const rt = composeRuntime();
    expect(rt.clock).toBeInstanceOf(SystemClock);
    expect(rt.watcher).toBeDefined();
    rt.stop();
  });

  it("makes the house live between turns: an idle game accrues off-screen events", () => {
    const clock = new FakeClock();
    const rt = composeRuntime({
      clock,
      watcher: { tickEveryMs: 1000, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 },
    });
    startGame(rt, U);
    const before = hidden(rt, U);

    rt.start();
    clock.advance(6000); // past the idle threshold

    expect(hidden(rt, U)).toBeGreaterThan(before); // off-screen scheming happened while away
    rt.stop();
  });

  it("bounds off-screen advances per wake (no season fast-forward)", () => {
    const clock = new FakeClock();
    const rt = composeRuntime({
      clock,
      watcher: { tickEveryMs: 1000, idleTickAfterMs: 1000, maxOffscreenTicksPerWake: 2, auditEveryMs: 0 },
    });
    startGame(rt, U);
    const before = hidden(rt, U);

    rt.start();
    clock.advance(1000); // exactly one wake

    // ≤7 hidden/tick (3 off-screen scenes + 1 NPC confessional + at most 1 overhear surfacing per
    // scene, 0049) × at most 2 ticks/wake = a bounded handful (the per-wake cap bounds TICKS, not
    // events — the house lives, never fast-forwards a season).
    expect(hidden(rt, U) - before).toBeLessThanOrEqual(2 * 7);
    rt.stop();
  });

  it("isolation: one user's off-screen life never bleeds into another's game", () => {
    const clock = new FakeClock();
    const rt = composeRuntime({
      clock,
      watcher: { tickEveryMs: 1000, idleTickAfterMs: 1000, maxOffscreenTicksPerWake: 2, auditEveryMs: 0 },
    });
    rt.registry.sandboxFor("user-a").session.createCharacter({ playerName: "A", seed: 1 });
    rt.registry.sandboxFor("user-b").session.createCharacter({ playerName: "B", seed: 2 });
    rt.orchestrator.touch("user-a");
    rt.orchestrator.touch("user-b");

    rt.start();
    clock.advance(2000);

    const aContent = rt.registry.sandboxFor("user-a").engine.events.query().map((e) => e.content).join("|");
    const bIds = rt.registry.sandboxFor("user-b").engine.events.query().map((e) => e.id);
    expect(bIds.every((id) => !aContent.includes(id))).toBe(true);
    rt.stop();
  });

  it("a cadence of 0 disables the watcher (pure turn-driven)", () => {
    const clock = new FakeClock();
    const rt = composeRuntime({ clock, watcher: { tickEveryMs: 0, idleTickAfterMs: 1, maxOffscreenTicksPerWake: 9, auditEveryMs: 0 } });
    startGame(rt, U);
    const before = hidden(rt, U);

    rt.start();
    clock.advance(1_000_000); // lots of time passes

    expect(hidden(rt, U)).toBe(before); // nothing advanced on its own
    rt.stop();
  });
});

describe("composeRuntime — deferResume (prod incident 2026-06-19: warm-up must not delay /health)", () => {
  const TURN_OFF = { tickEveryMs: 0, idleTickAfterMs: 1, maxOffscreenTicksPerWake: 1, auditEveryMs: 0 };

  it("eager by default; deferResume holds the boot resume until resumeSaved()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orwell-defer-"));
    const u = "user-defer";

    // process #1: create + PERSIST a saved game on disk
    const r1 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: TURN_OFF });
    r1.registry.sandboxFor(u).session.createCharacter({ playerName: "P", seed: 7 });
    await r1.orchestrator.commitPlayerTurn(u); // persist the snapshot
    r1.stop();

    // process #2 (EAGER, the default): the saved user is resumed at compose time
    const r2 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock(), watcher: TURN_OFF });
    expect(r2.registry.usernames()).toContain(u);
    r2.stop();

    // process #3 (DEFER): NOT resumed at compose — so /health can bind first — until resumeSaved()
    const r3 = composeRuntime({ saveStore: new FileSaveStore(dir), deferResume: true, clock: new FakeClock(), watcher: TURN_OFF });
    expect(r3.registry.usernames()).not.toContain(u);
    r3.resumeSaved();
    expect(r3.registry.usernames()).toContain(u);
    r3.stop();
  });
});

describe("watcherConfigFromEnv", () => {
  it("falls back to defaults when unset", () => {
    expect(watcherConfigFromEnv({})).toEqual(DEFAULT_WATCHER);
  });

  it("reads overrides and treats tick 0 as disabled", () => {
    const cfg = watcherConfigFromEnv({ ORWELL_WATCHER_TICK_MS: "0", ORWELL_WATCHER_MAX_TICKS: "5" });
    expect(cfg.tickEveryMs).toBe(0);
    expect(cfg.maxOffscreenTicksPerWake).toBe(5);
  });
});
