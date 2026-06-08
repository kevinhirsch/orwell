import { describe, it, expect, vi, afterEach } from "vitest";
import { SystemClock } from "../../src/adapters/time/SystemClock";

// SystemClock (feature 0035) is the production real-timer Clock+Scheduler. We drive it with
// vitest fake timers so the test is deterministic and has no real-time flakiness.
describe("SystemClock (real-timer Clock + Scheduler)", () => {
  afterEach(() => vi.useRealTimers());

  it("now() tracks wall time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(123_456);
    expect(new SystemClock().now()).toBe(123_456);
  });

  it("every(ms>0) fires on the cadence until cancelled", () => {
    vi.useFakeTimers();
    const clock = new SystemClock();
    const fn = vi.fn();
    const handle = clock.every(1000, fn);

    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);

    clock.cancel(handle);
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(3); // no further fires after cancel
  });

  it("every(0) is disabled — never fires (the pure turn-driven knob)", () => {
    vi.useFakeTimers();
    const clock = new SystemClock();
    const fn = vi.fn();
    clock.every(0, fn);
    vi.advanceTimersByTime(1_000_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not keep the process alive (the interval is unref'd)", () => {
    vi.useFakeTimers();
    const unref = vi.fn();
    const spy = vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as unknown as ReturnType<typeof setInterval>);
    new SystemClock().every(1000, () => {});
    expect(unref).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
