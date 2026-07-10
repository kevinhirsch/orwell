import { describe, expect, it } from "vitest";
import { composeRuntime } from "../../src/composition/runtime";
import { LogicalClock } from "../../src/adapters/time/LogicalClock";
import { FakeClock } from "../../src/adapters/time/FakeClock";

/**
 * M0-8 / 0108 — the logical clock, now the ONLY clock (real-time purge 2026-07-10, PO ruling). The
 * orchestrator's per-turn tick seeds derived rng streams and recency windows with `clock.now()`;
 * under wall time a slow (real-model record) run and a fast (fixture replay) run of the SAME
 * tool-call sequence diverged in presence/gossip state (ledger-proven, 2026-07-07). The runtime now
 * ALWAYS composes a `LogicalClock` (fixed epoch, advanced only on committed mutations), so identical
 * call sequences produce byte-identical worlds at ANY pacing — and there is no wall-clock path at all.
 *
 * Roles only — no cast names; the player name is a generic label.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function driveWalk(pauseMs: number): Promise<string> {
  const runtime = composeRuntime();
  const tools = runtime.registry.resolver()("player", "walker");
  await tools.callTool("createCharacter", { playerName: "P", seed: 108 });
  for (let i = 0; i < 6; i++) {
    await sleep(pauseMs); // the pacing under test — wall time between turns must not matter
    await tools.callTool("advanceGame", {});
  }
  return JSON.stringify(runtime.registry.snapshot("walker"));
}

describe("logical clock (M0-8) — the only clock: pacing-invariant engine time", () => {
  it("the runtime always composes a LogicalClock (no wall-clock path)", () => {
    const runtime = composeRuntime();
    expect(runtime.clock).toBeInstanceOf(LogicalClock);
    // Starts at the fixed epoch (2026-01-01T00:00:00Z) — plausible timestamps, never Date.now().
    expect(runtime.clock.now()).toBe(1_767_225_600_000);
  });

  it("an injected clock (tests) always wins over the default LogicalClock", () => {
    const injected = new FakeClock(42);
    const runtime = composeRuntime({ clock: injected });
    expect(runtime.clock).toBe(injected);
  });

  it("time advances on committed mutations only — reads never move it", async () => {
    const runtime = composeRuntime();
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
  });

  it("identical call sequences at different wall pacing produce byte-identical worlds", async () => {
    const fast = await driveWalk(1);
    const slow = await driveWalk(40);
    expect(slow).toBe(fast);
  }, 30_000);

  it("aux commits never tick the house — seating frozen between beats (M0-9)", async () => {
    // Under the logical clock every commit is a full step apart, so the play-clock aux debounce
    // (E57) can never absorb — pre-fix, each aux commit fired an off-screen tick and NPC seating
    // sampled at turn boundaries varied with the model's live round pacing (the 0076 movement-cue
    // replay fork). With auxTicksNever (always on now), aux commits (an interaction, a met-mark)
    // leave presence byte-stable; only beat commits move the house.
    const runtime = composeRuntime();
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
  }, 30_000);
});
