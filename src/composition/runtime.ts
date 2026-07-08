import { GameSessionRegistry } from "./registry";
import { Orchestrator } from "./orchestrator";
import { GameWatcher, type WatcherConfig } from "./gameWatcher";
import { SystemClock } from "../adapters/time/SystemClock";
import { FakeClock } from "../adapters/time/FakeClock";
import { FileSaveStore } from "../adapters/engine/FileSaveStore";
import { SqliteSaveStore } from "../adapters/sqlite/SqliteSaveStore";
import { FileUserNotorietyStore } from "../adapters/engine/FileUserNotorietyStore";
import type { Clock, Scheduler } from "../ports/Clock";
import type { UserSaveStore } from "../ports/UserSaveStore";

// ── the LOGICAL clock (M0-8 / 0108) ────────────────────────────────────────────────
//
// The orchestrator's per-turn tick seeds derived rng streams and recency windows with
// `clock.now()` (`confessional-recent/-phrasing:${clockNow}`, `orch:day:${clockNow}` ids) —
// correct for live play, but WALL time makes the tick pacing-dependent: a real-model
// golden-path RECORD walks in minutes-per-turn, its REPLAY in seconds, so the two runs live
// in different clocks and the world diverges even with byte-identical mutation sequences
// (proven by ledger diff, 2026-07-07: 36 identical mutations, different presence/gossip one
// turn later). `ORWELL_LOGICAL_CLOCK` swaps in a virtual clock that starts at a FIXED epoch
// and advances ONLY on committed mutations — identical commit sequences ⇒ identical clock
// sequences ⇒ identical tick behavior, at any pacing. Reads never advance it (read counts
// are wall-clock-paced — the driver's quiesce polls — and must stay clock-neutral).
// Set to "1" for the fixed default epoch, or to an epoch-ms integer. Unset ⇒ byte-identical
// to today (real `SystemClock`).

/** 2026-01-01T00:00:00Z — an arbitrary fixed epoch so logical timestamps read plausibly. */
const LOGICAL_CLOCK_EPOCH_MS = 1_767_225_600_000;
/** One committed mutation ≈ one in-house minute — keeps recency windows meaningful. */
const LOGICAL_CLOCK_STEP_MS = 60_000;

export function logicalClockFromEnv(env: Record<string, string | undefined> = process.env): FakeClock | null {
  const raw = (env.ORWELL_LOGICAL_CLOCK ?? "").trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "false") return null;
  const epoch = /^\d{6,}$/.test(raw) ? parseInt(raw, 10) : LOGICAL_CLOCK_EPOCH_MS;
  return new FakeClock(epoch);
}

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
  /** Resident-sandbox LRU cap (audit R4); env `ORWELL_MAX_RESIDENT_SANDBOXES` otherwise. */
  maxResidentSandboxes?: number;
  /**
   * Skip the eager boot-time resume of saved users (default: resume eagerly, as always). The
   * entrypoint sets this so it can bind the HTTP server + warm the embedder FIRST, then call
   * `resumeSaved()` — so a cold/blocked embedding model can never delay `/health`, and resumed
   * souls still capture the real embedder once it is warm (prod incident 2026-06-19).
   */
  deferResume?: boolean;
}

export interface Runtime {
  registry: GameSessionRegistry;
  orchestrator: Orchestrator;
  watcher: GameWatcher;
  clock: Clock & Scheduler;
  /** Is this a KNOWN user (live sandbox or durable save)? The network boundary's gate (B34). */
  knownUser(user: string): boolean;
  /** Resume saved users from disk (the boot preload). Called automatically unless `deferResume`
   *  was set, in which case the entrypoint calls it after binding HTTP + warming the embedder. */
  resumeSaved(): void;
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

/**
 * The durable save store the entrypoint composes when `durable` is set (B59/audit E7: the composition
 * layer constructs the engine-only adapter, so `main.ts` never imports one). E63: `ORWELL_STORE=sqlite`
 * selects the relational `SqliteSaveStore` (same versioned-blob, never-overwrite, lossless semantics);
 * DEFAULT unset ⇒ the file-backed `FileSaveStore` (today's behavior — unchanged).
 */
function buildDurableStore(env: Record<string, string | undefined> = process.env): UserSaveStore {
  return (env.ORWELL_STORE ?? "").trim().toLowerCase() === "sqlite"
    ? new SqliteSaveStore()
    : new FileSaveStore();
}

export function composeRuntime(opts: RuntimeOptions = {}): Runtime {
  // An injected clock (tests) always wins; else the env-gated logical clock; else real time.
  const logicalClock = opts.clock ? null : logicalClockFromEnv();
  const clock: Clock & Scheduler = opts.clock ?? logicalClock ?? new SystemClock();
  const saveStore = opts.saveStore ?? (opts.durable ? buildDurableStore() : undefined);
  const envResident = parseInt((process.env.ORWELL_MAX_RESIDENT_SANDBOXES ?? "").trim(), 10);
  const maxResident = opts.maxResidentSandboxes
    ?? (Number.isFinite(envResident) && envResident > 0 ? envResident : undefined);
  // 0104 — when the runtime is durable, persist account-level NOTORIETY to disk too (a SEPARATE subtree
  // from the per-season saves, so the season-restart rotation never touches it — account reputation
  // survives the cutover). In-memory otherwise (the registry defaults to an in-memory store).
  const notorietyStore = saveStore ? new FileUserNotorietyStore() : undefined;
  const registry = new GameSessionRegistry(saveStore, {
    ...(maxResident !== undefined ? { maxResident } : {}),
    ...(notorietyStore ? { notorietyStore } : {}),
  });
  const cfg: WatcherConfig = { ...watcherConfigFromEnv(), ...opts.watcher };
  // The logical clock is turn-driven BY DEFINITION (time moves on commits) — a wall-clock
  // watcher cadence would make FakeClock.advance fire watcher jobs per commit, a nonsense
  // hybrid. Force pure turn-driven and say so, rather than compose it silently wrong.
  if (logicalClock && cfg.tickEveryMs !== 0) {
    console.warn("[runtime] ORWELL_LOGICAL_CLOCK forces pure turn-driven mode — ignoring watcher cadence");
    cfg.tickEveryMs = 0;
  }
  // Pure turn-driven mode (watcher disabled): the orchestrator fires one off-screen tick per player turn.
  const orchestrator = new Orchestrator(registry, clock, {
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    turnDriven: cfg.tickEveryMs === 0,
  });
  // The orchestrator becomes the real spine (B41/audit E3): every player-channel mutation now commits
  // through the fail-closed integrity checkpoint (+ touch + idle gating), not a blind save.
  // M0-8: under the logical clock, time advances HERE — once per committed mutation, before
  // the commit runs, so the tick this commit fires sees the new minute. Reads never advance.
  registry.setCommit((user) => {
    if (logicalClock) logicalClock.advance(LOGICAL_CLOCK_STEP_MS);
    try {
      orchestrator.commitPlayerTurn(user);
    } catch (e) {
      // A REFUSED commit (TurnRefused / PersistFailure) rolled the sandbox back — roll the
      // minute back too, so a retry of the same turn sees the same clock-derived tick seeds
      // and recency windows (review finding: an advanced clock on a failed commit would fork
      // the retry). Refusals are deterministic, so record and replay roll back alike.
      if (logicalClock) logicalClock.advance(-LOGICAL_CLOCK_STEP_MS);
      throw e;
    }
  });
  // The ONE restart door is COMPLETE (audit E1/D1/R1): when a season resets — admin reset or the
  // player channel's confirmed restart, both via registry.resetUser — the orchestrator forgets the
  // dead season's baseline/faults/rng, so season 2's first commit is a first commit, never a
  // "degradation" against a finished season.
  registry.setOnReset((user) => orchestrator.forgetUser(user));
  // #1067 — a fail-soft background enrichment (the season-start cast-authoring upgrade) replaced live
  // state outside the commit seam; re-seed the non-degradation baseline to the freshly-saved state so the
  // next player-turn commit isn't refused as a "degradation" against the stale floor baseline (the same
  // seedBaseline discipline a resume-from-disk uses — audit E6).
  registry.setOnBackgroundCommit((user) => orchestrator.seedBaseline(user));
  // God Mode can SEE sandbox health (B58/audit E5+E6): integrity, faults, the circuit state.
  registry.setHealthProvider((user) => orchestrator.sandboxHealth(user));
  // Preload saved users at boot (B60/audit E11): without this, every deploy froze each house until
  // that user's NEXT request — resume them now so the watcher/turn loop can see them immediately.
  // A user whose save fails to resolve is skipped (B35's tolerant-load handles the quarantine).
  // Each resumed game also SEEDS the non-degradation baseline (audit E6): the first commit after an
  // engine restart used to be checkpoint-blind — the guard's hole sat exactly at resume-from-disk.
  const resumeSaved = (): void => {
    for (const user of saveStore?.listUsers?.() ?? []) {
      try {
        registry.sandboxFor(user);
        orchestrator.seedBaseline(user);
      } catch { /* skip an unresumable save; the rest still boot */ }
    }
  };
  // Default: resume eagerly (tests + every non-entrypoint caller keep the original behavior). The
  // entrypoint passes deferResume so it can bind /health + warm the embedder before resuming.
  if (!opts.deferResume) resumeSaved();
  const watcher = new GameWatcher(registry, orchestrator, clock, clock, cfg);
  return {
    registry,
    orchestrator,
    watcher,
    clock,
    knownUser: (user) => registry.usernames().includes(user) || (saveStore?.hasSave(user) ?? false),
    resumeSaved,
    start: () => watcher.start(),
    stop: () => watcher.stop(),
  };
}
