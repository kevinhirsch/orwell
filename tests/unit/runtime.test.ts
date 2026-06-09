import { describe, it, expect } from "vitest";
import { composeRuntime, watcherConfigFromEnv, DEFAULT_WATCHER } from "../../src/composition/runtime";
import { SystemClock } from "../../src/adapters/time/SystemClock";
import { FakeClock } from "../../src/adapters/time/FakeClock";

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

    // ~4 hidden/tick (3 off-screen scenes + 1 NPC confessional) × at most 2 ticks/wake = a bounded
    // handful (the per-wake cap bounds TICKS, not events — the house lives, never fast-forwards a season).
    expect(hidden(rt, U) - before).toBeLessThanOrEqual(2 * 4);
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
