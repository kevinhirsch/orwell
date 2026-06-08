import type { Clock, Scheduler, SchedulerHandle } from "../../ports/Clock";

/**
 * The production Clock + Scheduler (feature 0035) — the real-timer counterpart to
 * `FakeClock`. `now()` is wall time; `every()` arms a real `setInterval` (unref'd
 * so the background watcher never keeps the process alive on its own); `cancel()`
 * clears it. A cadence of 0 is treated as DISABLED (no timer armed), matching the
 * watcher's pure turn-driven fallback. Engine-internal; carries no game logic.
 */
export class SystemClock implements Clock, Scheduler {
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setInterval>>();

  now(): number {
    return Date.now();
  }

  every(ms: number, fn: () => void): SchedulerHandle {
    const handle: SchedulerHandle = { id: this.nextId++ };
    if (ms > 0) {
      const timer = setInterval(fn, ms);
      // Don't let the watcher's interval block process exit.
      (timer as { unref?: () => void }).unref?.();
      this.timers.set(handle.id, timer);
    }
    return handle;
  }

  cancel(handle: SchedulerHandle): void {
    const timer = this.timers.get(handle.id);
    if (timer !== undefined) {
      clearInterval(timer);
      this.timers.delete(handle.id);
    }
  }
}
