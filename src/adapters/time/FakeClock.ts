import type { Clock } from "../../ports/Clock";

/**
 * A deterministic, TEST-ONLY `Clock` (never used in production — the runtime uses `LogicalClock`).
 * It is a plain monotonic counter: `now()` is stable until `advance(n)` bumps it. It reads NO
 * real-world time and never has — after the 2026-07-10 real-time purge it lost its old `Scheduler`
 * role entirely (there is no background watcher to drive), so it is just a controllable counter a
 * test can hold steady or step forward.
 */
export class FakeClock implements Clock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  /** Step the counter forward by `n` (default 1). No timers, no callbacks — purely a value bump. */
  advance(n = 1): void {
    this.current += n;
  }
}
