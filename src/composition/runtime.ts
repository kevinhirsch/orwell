import { GameSessionRegistry } from "./registry";
import { Orchestrator } from "./orchestrator";
import { GameWatcher, type WatcherConfig } from "./gameWatcher";
import { SystemClock } from "../adapters/time/SystemClock";
import { FileSaveStore } from "../adapters/engine/FileSaveStore";
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
  /**
   * Compose the default disk-backed store (B59/audit E7): the entrypoint asks for durability and
   * the COMPOSITION layer constructs it, so `main.ts` never imports an engine-only adapter (it now
   * sits inside the dependency-cruiser OUTWARD set). Ignored when `saveStore` is given.
   */
  durable?: boolean;
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
  /** Is this a KNOWN user (live sandbox or durable save)? The network boundary's gate (B34). */
  knownUser(user: string): boolean;
  /** Start the background watcher (no-op when cadence is 0). */
  start(): void;
  /** Tear the watcher down (cancels its timer). */
  stop(): void;
}

/**
 * Defaults: pure turn-driven (tickEveryMs=0). The house does not exist when the player is away —
 * no background scheming, no relationship drift, nothing. The game clock runs only when the player
 * acts. One bounded off-screen tick fires per player turn via maybeTurnDrivenTick (Orchestrator).
 *
 * The watcher (tickEveryMs>0) is an opt-in operator knob via ORWELL_WATCHER_TICK_MS. Never enable
 * it by default — it would let the house scheme freely while the player has zero ability to react.
 */
export const DEFAULT_WATCHER: WatcherConfig = {
  tickEveryMs: 0,
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
  const saveStore = opts.saveStore ?? (opts.durable ? new FileSaveStore() : undefined);
  const registry = new GameSessionRegistry(saveStore);
  const cfg: WatcherConfig = { ...watcherConfigFromEnv(), ...opts.watcher };
  // Pure turn-driven mode (watcher disabled): the orchestrator fires one off-screen tick per player turn.
  const orchestrator = new Orchestrator(registry, clock, {
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    turnDriven: cfg.tickEveryMs === 0,
  });
  // The orchestrator becomes the real spine (B41/audit E3): every player-channel mutation now commits
  // through the fail-closed integrity checkpoint (+ touch + idle gating), not a blind save.
  registry.setCommit((user) => orchestrator.commitPlayerTurn(user));
  // God Mode can SEE sandbox health (B58/audit E5+E6): integrity, faults, the circuit state.
  registry.setHealthProvider((user) => orchestrator.sandboxHealth(user));
  const watcher = new GameWatcher(registry, orchestrator, clock, clock, cfg);
  return {
    registry,
    orchestrator,
    watcher,
    clock,
    knownUser: (user) => registry.usernames().includes(user) || (saveStore?.hasSave(user) ?? false),
    start: () => watcher.start(),
    stop: () => watcher.stop(),
  };
}
