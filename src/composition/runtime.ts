import { GameSessionRegistry } from "./registry";
import { Orchestrator } from "./orchestrator";
import { GameWatcher, type WatcherConfig } from "./gameWatcher";
import { SystemClock } from "../adapters/time/SystemClock";
import type { Clock, Scheduler } from "../ports/Clock";
import type { UserSaveStore } from "../ports/UserSaveStore";

/**
 * Live engine runtime composition (feature 0035). Wires the per-user
 * `GameSessionRegistry` (0021), the 0031 `Orchestrator`, and the background
 * `GameWatcher` behind a real-timer clock — so the house actually LIVES between
 * player turns (off-screen scheming + integrity audits), not just in tests.
 *
 * 0031 built the watcher/orchestrator but nothing ever started them and there was
 * no real-timer clock; `composeRuntime` + `main.ts` close that gap. Tests inject a
 * `FakeClock` for determinism; `tickEveryMs: 0` disables the watcher (pure
 * turn-driven). This module carries no game logic — it only assembles and starts.
 */
export interface RuntimeOptions {
  /** Durable store (0030). Omit for a purely in-memory runtime. */
  saveStore?: UserSaveStore;
  /** Clock+Scheduler the watcher runs behind. Default: real-timer `SystemClock`. */
  clock?: Clock & Scheduler;
  /** Watcher cadence overrides (merged over env/defaults). */
  watcher?: Partial<WatcherConfig>;
  /** Deterministic off-screen RNG seed for the orchestrator. */
  seed?: number;
}

export interface Runtime {
  registry: GameSessionRegistry;
  orchestrator: Orchestrator;
  watcher: GameWatcher;
  clock: Clock & Scheduler;
  /** Start the background watcher (no-op when cadence is 0). */
  start(): void;
  /** Tear the watcher down (cancels its timer). */
  stop(): void;
}

/** Defaults: wake each minute, treat 5 min idle as "away", at most 3 off-screen ticks/wake, audit every 10 min. */
export const DEFAULT_WATCHER: WatcherConfig = {
  tickEveryMs: 60_000,
  idleTickAfterMs: 300_000,
  maxOffscreenTicksPerWake: 3,
  auditEveryMs: 600_000,
};

/** Read the watcher cadence from the environment; `ORWELL_WATCHER_TICK_MS=0` disables it. */
export function watcherConfigFromEnv(env: Record<string, string | undefined> = process.env): WatcherConfig {
  const num = (key: string, fallback: number): number => {
    const n = parseInt((env[key] ?? "").trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    tickEveryMs: num("ORWELL_WATCHER_TICK_MS", DEFAULT_WATCHER.tickEveryMs),
    idleTickAfterMs: num("ORWELL_WATCHER_IDLE_MS", DEFAULT_WATCHER.idleTickAfterMs),
    maxOffscreenTicksPerWake: num("ORWELL_WATCHER_MAX_TICKS", DEFAULT_WATCHER.maxOffscreenTicksPerWake),
    auditEveryMs: num("ORWELL_WATCHER_AUDIT_MS", DEFAULT_WATCHER.auditEveryMs),
  };
}

export function composeRuntime(opts: RuntimeOptions = {}): Runtime {
  const clock: Clock & Scheduler = opts.clock ?? new SystemClock();
  const registry = new GameSessionRegistry(opts.saveStore);
  const orchestrator = new Orchestrator(registry, clock, opts.seed !== undefined ? { seed: opts.seed } : {});
  const cfg: WatcherConfig = { ...watcherConfigFromEnv(), ...opts.watcher };
  const watcher = new GameWatcher(registry, orchestrator, clock, clock, cfg);
  return {
    registry,
    orchestrator,
    watcher,
    clock,
    start: () => watcher.start(),
    stop: () => watcher.stop(),
  };
}
