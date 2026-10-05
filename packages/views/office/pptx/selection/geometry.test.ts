import { describe, expect, it } from "vitest";
import type { PptxNodeBox } from "../canvas/render-tree";
import { box } from "../canvas/pptx-render-fixtures";
import {
  handlePosition,
  rotateHandlePositionInBounds,
  hitElement,
  hitHandle,
  marqueeSelection,
  moveBox,
  normalizeRect,
  rectsIntersect,
  resizeBox,
  rotateDegrees,
  rotateHandlePosition,
  selectionBounds,
  transformWithinBounds,
  unionBox,
} from "./geometry";

function nodeBox(sourceId: string, overrides: Partial<ReturnType<typeof box>> = {}, flags: Partial<PptxNodeBox> = {}): PptxNodeBox {
  return { sourceId, type: "shape", box: box(overrides), ...flags };
}

describe("marquee geometry", () => {
  it("normalises a drag in any direction", () => {
    expect(normalizeRect({ x: 100, y: 80 }, { x: 20, y: 10 })).toEqual({ x: 20, y: 10, w: 80, h: 70 });
  });

  it("treats a touching edge as no intersection", () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 0, w: 5, h: 5 })).toBe(true);
  });

  it("selects intersecting elements and skips decoration/background chrome", () => {
    const boxes = [
      nodeBox("a", { x: 0, y: 0, w: 40, h: 40 }),
      nodeBox("b", { x: 100, y: 100, w: 40, h: 40 }),
      nodeBox("deco", { x: 0, y: 0, w: 40, h: 40 }, { decoration: true }),
      nodeBox("bg", { x: 0, y: 0, w: 40, h: 40 }, { background: true }),
    ];
    expect(marqueeSelection(boxes, { x: 10, y: 10, w: 20, h: 20 })).toEqual(["a"]);
    expect(marqueeSelection(boxes, { x: -10, y: -10, w: 400, h: 400 })).toEqual(["a", "b"]);
  });

  it("unions boxes and reads selection bounds by id", () => {
    expect(unionBox([])).toBeNull();
    expect(unionBox([{ x: 10, y: 20, w: 10, h: 10 }, { x: 30, y: 5, w: 10, h: 30 }])).toEqual({ x: 10, y: 5, w: 30, h: 30 });
    const boxes = [nodeBox("a", { x: 0, y: 0, w: 10, h: 10 }), nodeBox("b", { x: 20, y: 20, w: 10, h: 10 })];
    expect(selectionBounds(boxes, ["b"])).toEqual({ x: 20, y: 20, w: 10, h: 10 });
    expect(selectionBounds(boxes, ["missing"])).toBeNull();
  });
});

describe("handles", () => {
  const bounds = { x: 100, y: 50, w: 200, h: 100 };

  it("places the eight handles on edges and corners", () => {
    expect(handlePosition(bounds, "nw")).toEqual({ x: 100, y: 50 });
    expect(handlePosition(bounds, "e")).toEqual({ x: 300, y: 100 });
    expect(handlePosition(bounds, "s")).toEqual({ x: 200, y: 150 });
    expect(rotateHandlePosition(bounds, 24)).toEqual({ x: 200, y: 26 });
  });

  it("keeps the rotate grip inside the slide when the box touches the top edge", () => {
    expect(rotateHandlePositionInBounds({ x: 100, y: 0, w: 200, h: 100 }, { widthPx: 960, heightPx: 540 })).toEqual({ x: 200, y: 11 });
    expect(rotateHandlePositionInBounds(bounds, { widthPx: 960, heightPx: 540 })).toEqual({ x: 200, y: 26 });
  });

  it("hit-tests a handle within the radius and nothing outside it", () => {
    expect(hitHandle(bounds, { x: 101, y: 51 })).toBe("nw");
    expect(hitHandle(bounds, { x: 200, y: 150 })).toBe("s");
    expect(hitHandle(bounds, { x: 200, y: 26 })).toBe("rotate");
    expect(hitHandle(bounds, { x: 200, y: 100 })).toBeNull();
  });

  it("hit-tests the rotate grip at the same clamped position the overlay draws", () => {
    const page = { widthPx: 960, heightPx: 540 };
    const topBox = { x: 100, y: 0, w: 200, h: 100 };
    // The grip is drawn at y = 11 (clamped inside the top edge), so the hit zone follows it.
    expect(hitHandle(topBox, { x: 200, y: 11 }, 6, 24, page)).toBe("rotate");
    // The phantom zone at the unclamped y = -24 is no longer reachable.
    expect(hitHandle(topBox, { x: 200, y: -24 }, 6, 24, page)).toBeNull();
    // Without a page the legacy unclamped position still answers (back-compat callers).
    expect(hitHandle(topBox, { x: 200, y: -24 })).toBe("rotate");
  });

  it("picks the topmost element under a point", () => {
    const boxes = [nodeBox("under", { x: 0, y: 0, w: 100, h: 100 }), nodeBox("over", { x: 10, y: 10, w: 50, h: 50 })];
    expect(hitElement(boxes, { x: 20, y: 20 })).toBe("over");
    expect(hitElement(boxes, { x: 80, y: 80 })).toBe("under");
    expect(hitElement(boxes, { x: 500, y: 500 })).toBeNull();
  });
});

describe("move / resize / rotate math", () => {
  const page = { widthPx: 960, heightPx: 540 };

  it("moves by the delta and keeps a sliver on the page", () => {
    expect(moveBox({ x: 10, y: 10, w: 20, h: 20 }, { x: 5, y: -5 }, page)).toEqual({ x: 15, y: 5, w: 20, h: 20 });
    const clamped = moveBox({ x: 900, y: 500, w: 40, h: 40 }, { x: 200, y: 200 }, page);
    expect(clamped.x).toBe(959);
    expect(clamped.y).toBe(539);
  });

  it("resizes from each edge without inverting the box", () => {
    const start = { x: 100, y: 100, w: 100, h: 100 };
    expect(resizeBox(start, "se", { x: 20, y: 30 })).toEqual({ x: 100, y: 100, w: 120, h: 130 });
    expect(resizeBox(start, "nw", { x: 10, y: 10 })).toEqual({ x: 110, y: 110, w: 90, h: 90 });
    expect(resizeBox(start, "e", { x: -500, y: 0 })).toEqual({ x: 100, y: 100, w: 1, h: 100 });
    expect(resizeBox(start, "n", { x: 0, y: 500 })).toEqual({ x: 100, y: 199, w: 100, h: 1 });
  });

  it("rotates to the pointer angle and snaps with shift", () => {
    const center = { x: 0, y: 0 };
    expect(rotateDegrees(center, { x: 0, y: -10 })).toBe(0);
    expect(rotateDegrees(center, { x: 10, y: 0 })).toBe(90);
    expect(rotateDegrees(center, { x: 0, y: 10 })).toBe(180);
    expect(rotateDegrees(center, { x: 9.8, y: -10 }, true)).toBe(45);
  });

  it("scales every member inside the resized group bounds", () => {
    const before = { x: 0, y: 0, w: 100, h: 100 };
    const after = { x: 0, y: 0, w: 200, h: 100 };
    const member = { x: 50, y: 50, w: 20, h: 20 };
    expect(transformWithinBounds(member, before, after, 0)).toEqual({ x: 100, y: 50, w: 40, h: 20, rotationDeg: 0 });
  });

  it("keeps members' offsets when the group is only rotated", () => {
    const bounds = { x: 0, y: 0, w: 100, h: 100 };
    expect(transformWithinBounds({ x: 10, y: 10, w: 20, h: 20 }, bounds, bounds, 45)).toEqual({ x: 10, y: 10, w: 20, h: 20, rotationDeg: 45 });
  });
});

describe("hitHandle on a tiny element (F6)", () => {
  // 8 x 8 page px: every handle sits within the 7px radius of the centre.
  const tiny = { x: 100, y: 100, w: 8, h: 8 };

  it("picks the nearest handle instead of always the first one in paint order", () => {
    expect(hitHandle(tiny, { x: 108, y: 108 }, 7)).toBe("se");
    expect(hitHandle(tiny, { x: 100, y: 108 }, 7)).toBe("sw");
    expect(hitHandle(tiny, { x: 104, y: 100 }, 7)).toBe("n");
    expect(hitHandle(tiny, { x: 108, y: 104 }, 7)).toBe("e");
    expect(hitHandle(tiny, { x: 104, y: 108 }, 7)).toBe("s");
    expect(hitHandle(tiny, { x: 100, y: 104 }, 7)).toBe("w");
  });

  it("breaks an exact tie by the fixed order (edges here: n before e, s, w)", () => {
    // The centre is 4px from all four edge midpoints and ~5.7px from the corners.
    expect(hitHandle(tiny, { x: 104, y: 104 }, 7)).toBe("n");
  });
});
