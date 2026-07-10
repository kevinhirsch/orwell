import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeRuntime } from "../../src/composition/runtime";
import { LogicalClock } from "../../src/adapters/time/LogicalClock";
import { FakeClock } from "../../src/adapters/time/FakeClock";
import { FileSaveStore } from "../../src/adapters/engine/FileSaveStore";

// Feature 0035 (real-time purge 2026-07-10, PO ruling): the runtime composes the per-user registry
// and the turn-driven orchestrator. There is NO wall-clock watcher and NO real-world clock — the
// house lives ONLY on the player's play-clock (one bounded off-screen tick per committed player
// turn). `composeRuntime` wires `registry.setCommit(commitPlayerTurn)`, so a mutation that persists
// through the registry drives that tick.

const U = "user-a";
const hidden = (rt: ReturnType<typeof composeRuntime>, u: string): number =>
  rt.registry.sandboxFor(u).engine.events.queryAll().filter((e) => e.hidden).length;

const startGame = (rt: ReturnType<typeof composeRuntime>, u: string): void => {
  rt.registry.sandboxFor(u).session.createCharacter({ playerName: "P", seed: 7 });
};

describe("composeRuntime (feature 0035 — turn-driven runtime, no real-world clock)", () => {
  it("defaults to a LogicalClock (a monotonic play-clock, never wall time) and exposes no watcher", () => {
    const rt = composeRuntime();
    expect(rt.clock).toBeInstanceOf(LogicalClock);
    // No background loop to start/stop — the runtime is purely turn-driven.
    expect((rt as unknown as Record<string, unknown>)["watcher"]).toBeUndefined();
    expect((rt as unknown as Record<string, unknown>)["start"]).toBeUndefined();
    expect((rt as unknown as Record<string, unknown>)["stop"]).toBeUndefined();
  });

  it("makes the house live between turns: committed player turns accrue off-screen events", () => {
    const rt = composeRuntime({ clock: new FakeClock() });
    startGame(rt, U); // composeRuntime wires setCommit — starting the game is itself a committed turn
    const sb = rt.registry.sandboxFor(U);
    // The house already lived on that first turn (the wired commit fired one bounded off-screen tick).
    expect(hidden(rt, U)).toBeGreaterThan(0);

    // Each further turn (a live-loop advance + its commit) keeps the house living on the play-clock.
    const before = hidden(rt, U);
    for (let i = 0; i < 3; i++) { sb.session.advanceGame(); rt.orchestrator.commitPlayerTurn(U); }
    expect(hidden(rt, U)).toBeGreaterThan(before); // more turns ⇒ more off-screen life
  });

  it("the house never fast-forwards: the WEEK only moves on the live loop, not the off-screen tick", () => {
    const rt = composeRuntime({ clock: new FakeClock() });
    startGame(rt, U);
    // The turn-driven off-screen tick is bounded society enrichment — it never advances the week on
    // its own (the live loop's own beats own progression). Starting the game leaves the week at 1.
    expect(rt.registry.sandboxFor(U).session.snapshot().week).toBe(1);
  });

  it("isolation: one user's off-screen life never bleeds into another's game", () => {
    const rt = composeRuntime({ clock: new FakeClock() });
    rt.registry.sandboxFor("user-a").session.createCharacter({ playerName: "A", seed: 1 });
    rt.registry.sandboxFor("user-b").session.createCharacter({ playerName: "B", seed: 2 });

    rt.orchestrator.commitPlayerTurn("user-a");
    rt.orchestrator.commitPlayerTurn("user-b");

    const aContent = rt.registry.sandboxFor("user-a").engine.events.queryAll().map((e) => e.content).join("|");
    const bIds = rt.registry.sandboxFor("user-b").engine.events.queryAll().map((e) => e.id);
    expect(bIds.every((id) => !aContent.includes(id))).toBe(true);
  });

  it("the game never advances while the player is away: nothing is committed ⇒ nothing accrues", () => {
    const rt = composeRuntime({ clock: new FakeClock() });
    startGame(rt, U);
    const before = hidden(rt, U);

    // No player turn is committed (the player is away). With no wall-clock watcher and no real-world
    // clock, absolutely nothing runs the house — it does not exist while the player is gone.
    expect(hidden(rt, U)).toBe(before);
  });
});

describe("composeRuntime — deferResume (prod incident 2026-06-19: warm-up must not delay /health)", () => {
  it("eager by default; deferResume holds the boot resume until resumeSaved()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orwell-defer-"));
    const u = "user-defer";

    // process #1: create + PERSIST a saved game on disk
    const r1 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock() });
    r1.registry.sandboxFor(u).session.createCharacter({ playerName: "P", seed: 7 });
    r1.orchestrator.commitPlayerTurn(u); // persist the snapshot

    // process #2 (EAGER, the default): the saved user is resumed at compose time
    const r2 = composeRuntime({ saveStore: new FileSaveStore(dir), clock: new FakeClock() });
    expect(r2.registry.usernames()).toContain(u);

    // process #3 (DEFER): NOT resumed at compose — so /health can bind first — until resumeSaved()
    const r3 = composeRuntime({ saveStore: new FileSaveStore(dir), deferResume: true, clock: new FakeClock() });
    expect(r3.registry.usernames()).not.toContain(u);
    r3.resumeSaved();
    expect(r3.registry.usernames()).toContain(u);
  });
});
