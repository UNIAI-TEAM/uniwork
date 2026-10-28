import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { effectiveValues, listKeyAction, useCloseOut } from "./use-close-out";

const item = (over: Partial<MeetingActionItem> = {}): MeetingActionItem =>
  ({
    id: "a1",
    title: "Gửi trang tóm tắt",
    status: "PENDING",
    evidence: [],
    suggested_assignee_id: "u-ha",
    suggested_due_date: "2026-10-26",
    suggested_due_guessed: true,
    suggested_priority: "high",
    ...over,
  }) as MeetingActionItem;

const key = (over: Partial<Parameters<typeof listKeyAction>[0]>) =>
  listKeyAction({ key: "ArrowDown", metaKey: false, ctrlKey: false, target: document.body, ...over });

describe("effectiveValues", () => {
  it("takes the suggestion, flags a guessed due date, and lets the clerk's change win", () => {
    expect(effectiveValues(item(), undefined)).toEqual({
      assignee_id: "u-ha",
      due_date: "2026-10-26",
      priority: "high",
      guessed: true,
    });
    // A due date the clerk picked is no longer a guess; clearing the owner is a real choice.
    expect(effectiveValues(item(), { due_date: "2026-10-27", assignee_id: null, priority: "low" })).toEqual({
      assignee_id: null,
      due_date: "2026-10-27",
      priority: "low",
      guessed: false,
    });
    // An older server sends no flag: not guessed.
    expect(effectiveValues(item({ suggested_due_guessed: undefined, suggested_priority: "" }), undefined)).toMatchObject({
      guessed: false,
      priority: "none",
    });
  });
});

describe("listKeyAction", () => {
  it("maps arrows and ⌘/Ctrl+Enter, and nothing else", () => {
    expect(key({})).toBe("next");
    expect(key({ key: "ArrowUp" })).toBe("prev");
    expect(key({ key: "Enter", ctrlKey: true })).toBe("review");
    expect(key({ key: "Enter", metaKey: true })).toBe("review");
    expect(key({ key: "Enter" })).toBeNull();
    expect(key({ key: "a" })).toBeNull();
  });

  it("ignores keys while an IME composes (Telex/VNI) or while typing in a field or a combobox", () => {
    expect(key({ isComposing: true })).toBeNull();
    expect(key({ keyCode: 229 })).toBeNull();
    const input = document.createElement("input");
    const combo = document.createElement("div");
    combo.setAttribute("role", "combobox");
    expect(key({ target: input })).toBeNull();
    expect(key({ target: combo })).toBeNull();
  });
});

describe("useCloseOut", () => {
  it("ticks, holds overrides, and prunes a tick once its item is no longer pending", () => {
    const a = item({ id: "a" });
    const b = item({ id: "b" });
    const { result, rerender } = renderHook(({ items }) => useCloseOut(items), { initialProps: { items: [a, b] } });
    act(() => result.current.setMany(["a", "b"], true));
    expect(result.current.picked.map((i) => i.id)).toEqual(["a", "b"]);
    act(() => result.current.setOverride("a", { priority: "urgent" }));
    expect(result.current.valuesOf(a).priority).toBe("urgent");

    // "b" was assigned elsewhere: it leaves the selection, and does not come back ticked when restored.
    rerender({ items: [a, { ...b, status: "CONVERTED" }] });
    expect(result.current.picked.map((i) => i.id)).toEqual(["a"]);
    rerender({ items: [a, b] });
    expect(result.current.isTicked("b")).toBe(false);

    act(() => result.current.clear());
    expect(result.current.picked).toEqual([]);
  });

  describe("after an assignment", () => {
    afterEach(() => vi.useRealTimers());

    it("undo bar leaves after eight seconds", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useCloseOut([item()]));
      act(() => result.current.markAssigned(["a1"]));
      expect(result.current.assigned?.ids).toEqual(["a1"]);
      act(() => {
        vi.advanceTimersByTime(7_999);
      });
      expect(result.current.assigned?.ids).toEqual(["a1"]);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.assigned).toBeNull();
    });

    it("a second assignment starts the eight seconds again, and clearing ends them", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useCloseOut([item()]));
      act(() => result.current.markAssigned(["a1"]));
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      act(() => result.current.markAssigned(["a2"]));
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(result.current.assigned?.ids).toEqual(["a2"]);
      act(() => result.current.clearAssigned());
      expect(result.current.assigned).toBeNull();
    });

    it("reads the wall clock, so a system sleep past the window ends the undo", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useCloseOut([item()]));
      act(() => result.current.markAssigned(["a1"]));
      // Asleep: the wall clock jumps, the timers did not run.
      vi.setSystemTime(Date.now() + 60_000);
      let ids: readonly string[] | null = ["x"];
      act(() => {
        ids = result.current.undoIds();
      });
      expect(ids).toBeNull();
      expect(result.current.assigned).toBeNull();
    });

    it("holding the dock pauses the countdown, up to the server's window", () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useCloseOut([item()]));
      act(() => result.current.markAssigned(["a1"]));
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      act(() => result.current.holdUndo(true));
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(result.current.undoIds()).toEqual(["a1"]);
      // Let go: the five seconds left are still there.
      act(() => result.current.holdUndo(false));
      act(() => {
        vi.advanceTimersByTime(4_750);
      });
      expect(result.current.assigned?.ids).toEqual(["a1"]);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(result.current.assigned).toBeNull();

      // Held past the server's two minutes, it ends anyway.
      act(() => result.current.markAssigned(["a2"]));
      act(() => result.current.holdUndo(true));
      act(() => {
        vi.advanceTimersByTime(120_000);
      });
      expect(result.current.assigned).toBeNull();
    });
  });
});
