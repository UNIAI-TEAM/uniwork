import { describe, expect, it } from "vitest";
import { FLOAT_TOOLBAR_GAP, FLOAT_TOOLBAR_MIN_HEIGHT, floatAnchor, renderableRect, selectionBox } from "./geometry";
import type { HtmlSelection } from "../selection/model";

function selection(rect: HtmlSelection["rect"]): HtmlSelection {
  return { sid: 7, rect, nodeName: null };
}

describe("renderableRect", () => {
  it("returns the rect of a selection that has one", () => {
    expect(renderableRect(selection({ x: 1, y: 2, width: 30, height: 40 }))).toEqual({ x: 1, y: 2, width: 30, height: 40 });
  });

  it("returns null when there is no selection or no rect yet", () => {
    expect(renderableRect(null)).toBeNull();
    expect(renderableRect(selection(null))).toBeNull();
  });

  it("returns null for a zero-size or non-finite rect instead of painting from it", () => {
    expect(renderableRect(selection({ x: 1, y: 2, width: 0, height: 40 }))).toBeNull();
    expect(renderableRect(selection({ x: 1, y: 2, width: 30, height: 0 }))).toBeNull();
    expect(renderableRect(selection({ x: Number.NaN, y: 2, width: 30, height: 40 }))).toBeNull();
    expect(renderableRect(selection({ x: 1, y: Number.POSITIVE_INFINITY, width: 30, height: 40 }))).toBeNull();
  });
});

describe("selectionBox", () => {
  it("is the same box the H5 outline paints: offset + zoom * rect", () => {
    expect(selectionBox({ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 0 }, 100)).toEqual({ left: 10, top: 20, width: 30, height: 40 });
    expect(selectionBox({ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 0 }, 200)).toEqual({ left: 20, top: 40, width: 60, height: 80 });
    expect(selectionBox({ x: 10, y: 20, width: 30, height: 40 }, { x: 300, y: 40 }, 150)).toEqual({ left: 315, top: 70, width: 45, height: 60 });
  });

  it("clamps a non-finite zoom to the ladder default and never emits NaN", () => {
    const box = selectionBox({ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 0 }, Number.NaN);
    expect(box.left).toBe(10);
    expect(box.width).toBe(30);
  });
});

describe("floatAnchor", () => {
  it("centres the toolbar on the box and lifts it just above", () => {
    const anchor = floatAnchor({ left: 100, top: 200, width: 80, height: 30 });
    expect(anchor.left).toBe(140);
    expect(anchor.top).toBe(200 - FLOAT_TOOLBAR_GAP);
    expect(anchor.placement).toBe("above");
  });

  it("flips below the box when there is no room above", () => {
    const anchor = floatAnchor({ left: 100, top: FLOAT_TOOLBAR_MIN_HEIGHT, width: 80, height: 30 });
    expect(anchor.top).toBe(FLOAT_TOOLBAR_MIN_HEIGHT + 30 + FLOAT_TOOLBAR_GAP);
    expect(anchor.placement).toBe("below");
  });

  it("never emits a non-finite coordinate", () => {
    const anchor = floatAnchor({ left: 0, top: 0, width: 0, height: 0 });
    expect(Number.isFinite(anchor.left)).toBe(true);
    expect(Number.isFinite(anchor.top)).toBe(true);
  });
});
