/**
 * Clock / Scheduler ports (feature 0031) — the seam the background game watcher
 * runs behind. The watcher holds NO game logic; it only asks the clock for the
 * time and the scheduler to call it back on a cadence. In production a real-timer
 * adapter backs these; in tests a FAKE clock advances time explicitly (no real
 * timers), so the whole supervised loop is deterministic and seed-reproducible.
 */
export interface Clock {
  /** Monotonic-ish wall time in milliseconds. */
  now(): number;
}

export interface SchedulerHandle {
  readonly id: number;
}

export interface Scheduler {
  /** Call `fn` every `ms`. Returns a handle to cancel it. A cadence of 0 means "never". */
  every(ms: number, fn: () => void): SchedulerHandle;
  cancel(handle: SchedulerHandle): void;
}
