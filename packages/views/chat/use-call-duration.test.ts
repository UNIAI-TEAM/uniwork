import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallDuration } from "./use-call-duration";

describe("useCallDuration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zero when inactive", () => {
    const { result } = renderHook(() => useCallDuration(false, Date.now()));
    expect(result.current).toBe(0);
  });

  it("ticks elapsed seconds while active", () => {
    const startedAt = Date.now() - 3_000;
    const { result } = renderHook(() => useCallDuration(true, startedAt));
    expect(result.current).toBeGreaterThanOrEqual(3);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toBeGreaterThanOrEqual(5);
  });
});
