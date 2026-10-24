import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnreadableCandidate } from "@uniwork/core/documents/folder-upload";
import { useUnreadableCheck } from "./use-unreadable-check";

// A size-0 blob whose read the test settles by hand.
function unstatable(path: string): { candidate: UnreadableCandidate; fail: () => void; pass: () => void } {
  let settle: (ok: boolean) => void = () => undefined;
  const pending = new Promise<ArrayBuffer>((resolve, reject) => {
    settle = (ok) => (ok ? resolve(new ArrayBuffer(0)) : reject(new DOMException("not found", "NotFoundError")));
  });
  class Blob0 extends Blob {
    override get size(): number {
      return 0;
    }
    override arrayBuffer(): Promise<ArrayBuffer> {
      return pending;
    }
  }
  return { candidate: { path, file: new Blob0(["x"]) }, fail: () => settle(false), pass: () => settle(true) };
}

const withBytes = (path: string): UnreadableCandidate => ({ path, file: new Blob(["x"]) });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useUnreadableCheck", () => {
  it("is ready at once, with nothing affected, when no file is empty (no probe, no flash)", () => {
    const stage = {};
    const { result } = renderHook(() => useUnreadableCheck(stage, [withBytes("R/a.pdf")]));
    expect(result.current).toEqual({ ready: true, checking: false, unreadable: [] });
  });

  it("is not ready while nothing is staged", () => {
    const { result } = renderHook(() => useUnreadableCheck(null, []));
    expect(result.current.ready).toBe(false);
  });

  it("stays closed through a quick probe and opens with the answer, never in the checking state", async () => {
    const stage = {};
    const probe = unstatable("R/long.pdf");
    const { result } = renderHook(() => useUnreadableCheck(stage, [probe.candidate]));
    expect(result.current.ready).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(result.current.ready).toBe(false);
    await act(async () => {
      probe.fail();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({ ready: true, checking: false, unreadable: ["R/long.pdf"] });
  });

  it("opens in the checking state only once the probe passes 400 ms", async () => {
    const stage = {};
    const probe = unstatable("R/slow.pdf");
    const { result } = renderHook(() => useUnreadableCheck(stage, [probe.candidate]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current).toEqual({ ready: true, checking: true, unreadable: [] });
    await act(async () => {
      probe.pass();
      await vi.advanceTimersByTimeAsync(0);
    });
    // A readable empty file: nothing affected.
    expect(result.current).toEqual({ ready: true, checking: false, unreadable: [] });
  });

  it("starts over for the next staged folder and drops the answer of the one left", async () => {
    const first = {};
    const second = {};
    const probe = unstatable("R/a.pdf");
    const { result, rerender } = renderHook(({ stage, files }) => useUnreadableCheck(stage, files), {
      initialProps: { stage: first as object | null, files: [probe.candidate] },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.checking).toBe(true);
    rerender({ stage: second, files: [withBytes("S/b.pdf")] });
    expect(result.current).toEqual({ ready: true, checking: false, unreadable: [] });
    await act(async () => {
      probe.fail();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.unreadable).toEqual([]);
  });

  it("cancels the probe when the stage goes away (Hủy, Esc, unmount)", async () => {
    const stage = {};
    const probe = unstatable("R/a.pdf");
    const { result, rerender, unmount } = renderHook(({ stage: s }) => useUnreadableCheck(s, [probe.candidate]), {
      initialProps: { stage: stage as object | null },
    });
    rerender({ stage: null });
    await act(async () => {
      probe.fail();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current).toEqual({ ready: false, checking: false, unreadable: [] });
    unmount();
  });
});
