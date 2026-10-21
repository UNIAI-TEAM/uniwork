import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRetryTimers, retryDelay, RETRY_DELAYS_MS } from "./retry-timers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("retry timers", () => {
  it("waits 2, 5, 15 then 60 s, each spread ±20 %", () => {
    expect(RETRY_DELAYS_MS).toEqual([2_000, 5_000, 15_000, 60_000]);
    expect([0, 1, 2, 3, 9].map((n) => retryDelay(n, () => 0.5))).toEqual([2_000, 5_000, 15_000, 60_000, 60_000]);
    expect(retryDelay(0, () => 0)).toBe(1_600);
    expect(retryDelay(0, () => 1)).toBe(2_400);
    expect(retryDelay(-1, () => 0.5)).toBe(2_000);
    expect(retryDelay(0)).toBeGreaterThanOrEqual(1_600);
  });

  it("one timer per key, backing off with each failure until reset; sign-out cancels them all", () => {
    const timers = createRetryTimers(() => 0.5);
    const run = vi.fn();
    timers.schedule("k", run);
    timers.schedule("k", run);
    vi.advanceTimersByTime(1_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);

    timers.schedule("k", run);
    vi.advanceTimersByTime(4_999);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);

    timers.schedule("k", run);
    timers.reset("k");
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    timers.schedule("k", run);
    vi.advanceTimersByTime(2_000);
    expect(run).toHaveBeenCalledTimes(3);

    timers.schedule("a", run);
    timers.schedule("b", run);
    timers.cancelAll();
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
