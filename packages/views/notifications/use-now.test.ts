import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

describe("useNow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks on the interval and stops when unmounted", async () => {
    vi.setSystemTime(new Date("2026-09-14T10:00:00Z"));
    const { result, unmount } = renderHook(() => useNow(60_000));
    expect(result.current.toISOString()).toBe("2026-09-14T10:00:00.000Z");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toISOString()).toBe("2026-09-14T10:01:00.000Z");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
