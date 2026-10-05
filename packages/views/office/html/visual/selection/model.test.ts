import { describe, expect, it, vi } from "vitest";
import {
  createPreviewEventSink,
  HTML_SELECTION_EMPTY,
  reduceSelection,
  type HtmlSelectionState,
} from "./model";

const SELECT = { type: "select", sid: 7 } as const;
const RECT = { type: "rect", sid: 7, rect: { x: 10, y: 20, width: 30, height: 40 } } as const;

function selected(state: HtmlSelectionState) {
  const value = state.selected;
  if (value === null) throw new Error("expected a selection");
  return value;
}

describe("reduceSelection: valid payloads", () => {
  it("maps a select to its sid, and a rect to the same sid's geometry", () => {
    const afterSelect = reduceSelection(HTML_SELECTION_EMPTY, SELECT);
    expect(selected(afterSelect).sid).toBe(7);
    expect(selected(afterSelect).rect).toBeNull();

    const afterRect = reduceSelection(afterSelect, RECT);
    expect(selected(afterRect).sid).toBe(7);
    expect(selected(afterRect).rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("keeps a nodeName when the payload carries a tag-shaped one", () => {
    const state = reduceSelection(HTML_SELECTION_EMPTY, { type: "select", sid: 3, nodeName: "SECTION" });
    expect(selected(state).nodeName).toBe("section");
  });

  it("drops a nodeName that is not tag-shaped instead of trusting it", () => {
    for (const nodeName of ["<img onerror=x>", "a".repeat(33), "1div", "", 42, null]) {
      const state = reduceSelection(HTML_SELECTION_EMPTY, { type: "select", sid: 3, nodeName });
      expect(selected(state).nodeName).toBeNull();
    }
  });

  it("clears the selection on a select with a null sid", () => {
    const state = reduceSelection(reduceSelection(HTML_SELECTION_EMPTY, SELECT), { type: "select", sid: null });
    expect(state.selected).toBeNull();
  });

  it("clamps an out-of-bounds rect so the overlay can never paint past the bound", () => {
    const state = reduceSelection(
      reduceSelection(HTML_SELECTION_EMPTY, SELECT),
      { type: "rect", sid: 7, rect: { x: -9e9, y: 9e9, width: -5, height: 9e9 } },
    );
    expect(selected(state).rect).toEqual({ x: -10_000_000, y: 10_000_000, width: 0, height: 10_000_000 });
  });

  it("applies a rect to the hovered element too, without touching the selection", () => {
    let state = reduceSelection(HTML_SELECTION_EMPTY, SELECT);
    state = reduceSelection(state, { type: "hover", sid: 9 });
    state = reduceSelection(state, { type: "rect", sid: 9, rect: { x: 1, y: 2, width: 3, height: 4 } });
    expect(selected(state).sid).toBe(7);
    expect(state.hovered?.rect).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});

describe("reduceSelection: hover never clobbers a select", () => {
  it("keeps the selection while hover moves across other elements", () => {
    let state = reduceSelection(HTML_SELECTION_EMPTY, SELECT);
    state = reduceSelection(state, RECT);
    state = reduceSelection(state, { type: "hover", sid: 12 });
    state = reduceSelection(state, { type: "hover", sid: 13 });
    expect(selected(state).sid).toBe(7);
    expect(selected(state).rect).toEqual(RECT.rect);
    expect(state.hovered?.sid).toBe(13);
  });

  it("ignores a rect for an element that is neither selected nor hovered", () => {
    let state = reduceSelection(HTML_SELECTION_EMPTY, SELECT);
    state = reduceSelection(state, { type: "rect", sid: 99, rect: RECT.rect });
    expect(selected(state).rect).toBeNull();
    expect(state.hovered).toBeNull();
  });
});

describe("reduceSelection: malformed payloads are ignored", () => {
  const malformed: unknown[] = [
    null,
    undefined,
    42,
    "select",
    [],
    {},
    { sid: 7 },
    { type: 7, sid: 7 },
    { type: "select" },
    { type: "select", sid: 0 },
    { type: "select", sid: -1 },
    { type: "select", sid: 1.5 },
    { type: "select", sid: "7" },
    { type: "select", sid: Number.NaN },
    { type: "select", sid: Number.POSITIVE_INFINITY },
    { type: "select", sid: 2 ** 31 },
    { type: "hover", sid: "9" },
    { type: "rect", sid: 7 },
    { type: "rect", sid: 7, rect: null },
    { type: "rect", sid: 7, rect: [] },
    { type: "rect", sid: 7, rect: { x: 1, y: 2, width: 3 } },
    { type: "rect", sid: 7, rect: { x: "1", y: 2, width: 3, height: 4 } },
    { type: "rect", sid: 7, rect: { x: 1, y: 2, width: Number.NaN, height: 4 } },
    { type: "rect", sid: 7, rect: { x: 1, y: 2, width: Number.POSITIVE_INFINITY, height: 4 } },
    { type: "rect", sid: null, rect: RECT.rect },
    { type: "text-edit-commit", sid: 7, text: "hi" },
    { type: "ready" },
    { type: "resize", height: 100 },
  ];

  it.each(malformed.map((value) => [JSON.stringify(value) ?? "undefined", value] as const))(
    "leaves the state untouched for %s",
    (_label, value) => {
      const state = reduceSelection(HTML_SELECTION_EMPTY, SELECT);
      expect(reduceSelection(state, value)).toBe(state);
    },
  );

  it("returns the same state identity for an unrelated event, so React can bail out", () => {
    const state = reduceSelection(HTML_SELECTION_EMPTY, SELECT);
    expect(reduceSelection(state, { type: "ready" })).toBe(state);
    expect(reduceSelection(state, { type: "select", sid: null })).not.toBe(state);
  });
});

describe("createPreviewEventSink", () => {
  it("delivers every event to every subscriber and stops after unsubscribe", () => {
    const sink = createPreviewEventSink();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = sink.subscribe(first);
    const offSecond = sink.subscribe(second);

    sink.emit(SELECT);
    expect(first).toHaveBeenCalledWith(SELECT);
    expect(second).toHaveBeenCalledWith(SELECT);

    offFirst();
    sink.emit(RECT);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    offSecond();
    sink.emit(RECT);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("keeps delivering to the other subscribers when one throws", () => {
    const sink = createPreviewEventSink();
    const healthy = vi.fn();
    sink.subscribe(() => {
      throw new Error("boom");
    });
    sink.subscribe(healthy);
    expect(() => sink.emit(SELECT)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(SELECT);
  });
});
