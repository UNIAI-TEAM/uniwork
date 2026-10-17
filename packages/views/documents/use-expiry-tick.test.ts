import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExpiryTick } from "./use-expiry-tick";

describe("useExpiryTick", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-15T03:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("re-renders once at the earliest future deadline, and not for past or absent ones", () => {
    let renders = 0;
    const { rerender } = renderHook(({ at }: { at: (string | null)[] }) => { renders++; useExpiryTick(at); }, {
      initialProps: { at: ["2026-10-15T03:10:00Z", "2026-10-15T03:05:00Z", "2026-10-15T02:00:00Z", null] },
    });
    const before = renders;
    act(() => void vi.advanceTimersByTime(4 * 60_000));
    expect(renders).toBe(before);
    act(() => void vi.advanceTimersByTime(60_000 + 1_000));
    expect(renders).toBeGreaterThan(before);
    // The next deadline (03:10) arms again after that render.
    const mid = renders;
    rerender({ at: ["2026-10-15T03:10:00Z"] });
    act(() => void vi.advanceTimersByTime(5 * 60_000));
    expect(renders).toBeGreaterThan(mid);
  });
});
