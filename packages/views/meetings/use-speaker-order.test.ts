import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPEAKER_HOLD_MS } from "./conference-layout";
import { useSpeakerOrder } from "./use-speaker-order";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

type Props = { speaking: string[] };
const cameras = ["x", "a", "b", "c"];

function setup() {
  return renderHook(({ speaking }: Props) => useSpeakerOrder(cameras, 1, speaking), {
    initialProps: { speaking: [] as string[] },
  });
}

describe("useSpeakerOrder", () => {
  it("keeps a speaker on stage while they keep talking, however long", () => {
    const { result, rerender } = setup();
    rerender({ speaking: ["a"] });
    expect(result.current[0]).toBe("a");
    // a talks for ten seconds with no report in between, then stops just as b starts.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender({ speaking: ["b"] });
    expect(result.current[0]).toBe("a");
  });

  it("hands the slot over once the hold runs out, without another report", () => {
    const { result, rerender } = setup();
    rerender({ speaking: ["a"] });
    rerender({ speaking: ["b"] });
    expect(result.current[0]).toBe("a");
    act(() => {
      vi.advanceTimersByTime(SPEAKER_HOLD_MS - 1);
    });
    expect(result.current[0]).toBe("a");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual(["b", "x", "a", "c"]);
  });

  it("does not reshuffle when speakers come and go faster than the hold", () => {
    const { result, rerender } = setup();
    rerender({ speaking: ["a"] });
    const seen = new Set<string>();
    for (const who of ["b", "c", "b", "c"]) {
      act(() => {
        vi.advanceTimersByTime(400);
      });
      rerender({ speaking: [who] });
      seen.add(result.current[0]!);
    }
    expect([...seen]).toEqual(["a"]);
  });

  it("keeps the same order across renders that change nothing", () => {
    const { result, rerender } = setup();
    rerender({ speaking: ["c"] });
    const before = result.current;
    rerender({ speaking: ["c"] });
    expect(result.current).toBe(before);
  });
});
