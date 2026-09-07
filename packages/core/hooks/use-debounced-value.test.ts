import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds the value until typing stops", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "ab" });
    rerender({ v: "abc" });
    expect(result.current).toBe("a");
    act(() => void vi.advanceTimersByTime(299));
    expect(result.current).toBe("a");
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe("abc");
  });

  it("passes the value straight through without a delay", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 0), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    expect(result.current).toBe(2);
  });
});
