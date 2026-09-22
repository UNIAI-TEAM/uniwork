import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

function Clock({ id, interval }: { id: string; interval?: number }) {
  const now = useNow(interval);
  return <span data-testid={id}>{now}</span>;
}

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T09:00:30Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks on the minute boundary and keeps subscribers in step", () => {
    render(
      <>
        <Clock id="a" />
        <Clock id="b" />
      </>,
    );
    const start = Number(screen.getByTestId("a").textContent);
    expect(start).toBe(Date.parse("2026-09-22T09:00:30Z"));

    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(Number(screen.getByTestId("a").textContent)).toBe(start);

    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    const ticked = Number(screen.getByTestId("a").textContent);
    expect(ticked).toBeGreaterThanOrEqual(Date.parse("2026-09-22T09:01:00Z"));
    expect(screen.getByTestId("b").textContent).toBe(String(ticked));
  });

  it("refreshes when the tab becomes visible again", () => {
    render(<Clock id="a" interval={3_600_000} />);
    vi.setSystemTime(new Date("2026-09-22T09:20:00Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(Number(screen.getByTestId("a").textContent)).toBe(Date.parse("2026-09-22T09:20:00Z"));
  });
});
