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

  it("aux commits never tick under the logical clock — seating frozen between beats (M0-9)", async () => {
    // Under the logical clock every commit is a full step apart, so the wall-time aux
    // debounce (E57) can never absorb — pre-fix, each aux commit fired an off-screen tick
    // and NPC seating sampled at turn boundaries varied with the model's live round pacing
    // (the 0076 movement-cue replay fork). With auxTicksNever, aux commits (an interaction,
    // a met-mark) leave presence byte-stable; only beat commits move the house.
    process.env.ORWELL_LOGICAL_CLOCK = "1";
    const runtime = composeRuntime({ watcher: WATCHER_OFF });
    try {
      const tools = runtime.registry.resolver()("player", "frozen");
      await tools.callTool("createCharacter", { playerName: "P", seed: 9109 });
      // Reach the live house (premiere seats the cast).
      await tools.callTool("advanceGame", {});
      const state: any = await tools.callTool("getGameState", {});
      const ids: string[] = (state.house ?? [])
        .filter((h: any) => h.status === "active")
        .map((h: any) => h.id);
      expect(ids.length).toBeGreaterThan(2);
      const before: any = await tools.callTool("whereabouts", {});
      // A burst of AUX commits — each bumps the logical clock, none may tick the house.
      for (let i = 0; i < 3 && i < ids.length; i++) {
        await tools.callTool("recordInteraction", {
          initiator: "player", withIds: [ids[i]], kind: "social",
          content: "a quick word in passing", witnessSet: ["player", ids[i]],
        });
      }
      const after: any = await tools.callTool("whereabouts", {});
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    } finally {
      runtime.stop();
    }
  }, 30_000);
});
