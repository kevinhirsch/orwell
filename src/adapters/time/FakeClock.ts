import type { Clock, Scheduler, SchedulerHandle } from "../../ports/Clock";

/**
 * A deterministic Clock + Scheduler for tests (feature 0031). Time only moves when
 * `advance(ms)` is called; scheduled callbacks fire when enough fake time has
 * elapsed. No real timers, so the watcher + orchestrator are fully reproducible.
 *
 * A scheduler registered with `every(0, fn)` is DISABLED (never fires) — the knob
 * that turns the background watcher off, leaving pure turn-driven behavior.
 */
interface Job {
  handle: SchedulerHandle;
  everyMs: number;
  fn: () => void;
  nextAt: number;
  cancelled: boolean;
}

export class FakeClock implements Clock, Scheduler {
  private current: number;
  private nextId = 1;
  private readonly jobs: Job[] = [];

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  every(ms: number, fn: () => void): SchedulerHandle {
    const handle = { id: this.nextId++ };
    // Cadence 0 ⇒ disabled: registered but scheduled into the infinite future.
    this.jobs.push({ handle, everyMs: ms, fn, nextAt: ms > 0 ? this.current + ms : Infinity, cancelled: false });
    return handle;
  }

  cancel(handle: SchedulerHandle): void {
    const job = this.jobs.find((j) => j.handle.id === handle.id);
    if (job) job.cancelled = true;
  }

  /** Advance fake time by `ms`, firing every due scheduled callback in order. */
  advance(ms: number): void {
    const target = this.current + ms;
    // Fire jobs whose nextAt falls within (current, target], re-arming each.
    // Guard against runaway in case a callback schedules zero-interval work.
    let guard = 0;
    for (;;) {
      const due = this.jobs
        .filter((j) => !j.cancelled && j.nextAt <= target)
        .sort((a, b) => a.nextAt - b.nextAt)[0];
      if (!due || guard++ > 100_000) break;
      this.current = due.nextAt;
      due.nextAt += due.everyMs; // re-arm
      due.fn();
    }
    this.current = target;
  }
}
