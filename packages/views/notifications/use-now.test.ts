import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

describe("useNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks on the minute, shares one timer, and stops when unmounted", async () => {
    vi.setSystemTime(new Date("2026-09-14T10:00:00Z"));
    const a = renderHook(() => useNow(60_000));
    const b = renderHook(() => useNow(60_000));
    expect(a.result.current.toISOString()).toBe("2026-09-14T10:00:00.000Z");
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(60_020);
    });
    expect(a.result.current.getTime()).toBe(b.result.current.getTime());
    expect(a.result.current.toISOString()).toBe("2026-09-14T10:01:00.020Z");
    a.unmount();
    b.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
