import { afterEach, describe, expect, it } from "vitest";
import { composeRuntime, logicalClockFromEnv } from "../../src/composition/runtime";
import { SystemClock } from "../../src/adapters/time/SystemClock";
import { FakeClock } from "../../src/adapters/time/FakeClock";

/**
 * M0-8 / 0108 — the logical clock: pacing-invariance of the engine under
 * `ORWELL_LOGICAL_CLOCK`. The orchestrator's per-turn tick seeds derived rng streams and
 * recency windows with `clock.now()`; under wall time a slow (real-model record) run and a
 * fast (fixture replay) run of the SAME tool-call sequence diverge in presence/gossip state
 * (ledger-proven, 2026-07-07). Under the logical clock, time advances only on committed
 * mutations, so identical call sequences produce byte-identical worlds at ANY pacing.
 *
 * Roles only — no cast names; the player name is a generic label.
 */

const WATCHER_OFF = { tickEveryMs: 0, idleTickAfterMs: 5000, maxOffscreenTicksPerWake: 3, auditEveryMs: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function driveWalk(pauseMs: number): Promise<string> {
  const runtime = composeRuntime({ watcher: WATCHER_OFF });
  try {
    const tools = runtime.registry.resolver()("player", "walker");
    await tools.callTool("createCharacter", { playerName: "P", seed: 108 });
    for (let i = 0; i < 6; i++) {
      await sleep(pauseMs); // the pacing under test — wall time between turns
      await tools.callTool("advanceGame", {});
    }
    return JSON.stringify(runtime.registry.snapshot("walker"));
  } finally {
    runtime.stop();
  }
}

describe("logical clock (M0-8) — pacing-invariant engine time", () => {
  afterEach(() => {
    delete process.env.ORWELL_LOGICAL_CLOCK;
  });

  it("parses the env gate: unset/0/false ⇒ null, 1 ⇒ fixed epoch, digits ⇒ that epoch", () => {
    expect(logicalClockFromEnv({})).toBeNull();
    expect(logicalClockFromEnv({ ORWELL_LOGICAL_CLOCK: "0" })).toBeNull();
    expect(logicalClockFromEnv({ ORWELL_LOGICAL_CLOCK: "false" })).toBeNull();
    const fixed = logicalClockFromEnv({ ORWELL_LOGICAL_CLOCK: "1" });
    expect(fixed).toBeInstanceOf(FakeClock);
    expect(fixed!.now()).toBe(1_767_225_600_000);
    const custom = logicalClockFromEnv({ ORWELL_LOGICAL_CLOCK: "5000000" });
    expect(custom!.now()).toBe(5_000_000);
  });

  it("env unset composes the real SystemClock (byte-identical default)", () => {
    const runtime = composeRuntime({ watcher: WATCHER_OFF });
    try {
      expect(runtime.clock).toBeInstanceOf(SystemClock);
    } finally {
      runtime.stop();
    }
  });

  it("an injected clock (tests) always wins over the env gate", () => {
    process.env.ORWELL_LOGICAL_CLOCK = "1";
    const injected = new FakeClock(42);
    const runtime = composeRuntime({ clock: injected, watcher: WATCHER_OFF });
    try {
      expect(runtime.clock).toBe(injected);
    } finally {
      runtime.stop();
    }
  });

  it("time advances on committed mutations only — reads never move it", async () => {
    process.env.ORWELL_LOGICAL_CLOCK = "1";
    const runtime = composeRuntime({ watcher: WATCHER_OFF });
    try {
      const epoch = runtime.clock.now();
      const tools = runtime.registry.resolver()("player", "u");
      await tools.callTool("createCharacter", { playerName: "P", seed: 7 });
      const afterCreate = runtime.clock.now();
      expect(afterCreate).toBeGreaterThan(epoch);
      // Reads are clock-neutral: poll counts are wall-clock-paced (the golden driver's
      // quiesce loop) and must not perturb engine time.
      await tools.callTool("getGameState", {});
      await tools.callTool("getGameState", {});
      await tools.callTool("gameStatus", {});
      expect(runtime.clock.now()).toBe(afterCreate);
      await tools.callTool("advanceGame", {});
      expect(runtime.clock.now()).toBeGreaterThan(afterCreate);
    } finally {
      runtime.stop();
    }
  });

  it("identical call sequences at different wall pacing produce byte-identical worlds", async () => {
    process.env.ORWELL_LOGICAL_CLOCK = "1";
    const fast = await driveWalk(1);
    const slow = await driveWalk(40);
    expect(slow).toBe(fast);
  }, 30_000);
});
