import { describe, expect, it } from "vitest";
import type { PptxNodeBox } from "../canvas/render-tree";
import { box } from "../canvas/pptx-render-fixtures";
import { applyGesture, beginGesture, gestureCommitRequests, gestureHandleAt, gestureIsNoop } from "./gesture";

const page = { widthPx: 960, heightPx: 540 };

function boxes(): PptxNodeBox[] {
  return [
    { sourceId: "a", type: "shape", box: box({ x: 100, y: 100, w: 100, h: 100 }) },
    { sourceId: "b", type: "shape", box: box({ x: 300, y: 100, w: 100, h: 100 }) },
  ];
}

describe("selection gestures", () => {
  it("returns null when nothing is selected", () => {
    expect(beginGesture({ boxes: boxes(), selectedIds: [], page }, { x: 0, y: 0 }, null)).toBeNull();
  });

  it("opens a move gesture on the union bounds and previews the delta", () => {
    const gesture = beginGesture({ boxes: boxes(), selectedIds: ["a", "b"], page }, { x: 150, y: 150 }, null);
    expect(gesture?.kind).toBe("move");
    expect(gesture?.bounds).toEqual({ x: 100, y: 100, w: 300, h: 100 });
    const moved = applyGesture(gesture!, { x: 170, y: 130 }, page);
    expect(moved.members.map((member) => [member.sourceId, member.preview.x, member.preview.y])).toEqual([
      ["a", 120, 80],
      ["b", 320, 80],
    ]);
  });

  it("resizes the bounds and scales members with them", () => {
    const gesture = beginGesture({ boxes: boxes(), selectedIds: ["a"], page }, { x: 200, y: 200 }, "se");
    expect(gesture?.kind).toBe("resize");
    const resized = applyGesture(gesture!, { x: 250, y: 250 }, page);
    expect(resized.members[0]!.preview).toEqual({ x: 100, y: 100, w: 150, h: 150, rotationDeg: 0 });
  });

  it("rotates the selection around its centre", () => {
    const gesture = beginGesture({ boxes: boxes(), selectedIds: ["a"], page }, { x: 150, y: 76 }, "rotate");
    expect(gesture?.kind).toBe("rotate");
    const rotated = applyGesture(gesture!, { x: 250, y: 150 }, page);
    expect(rotated.rotationDeltaDeg).toBe(90);
    expect(rotated.members[0]!.preview.rotationDeg).toBe(90);
  });

  it("emits exactly one commit request per selected element, from the preview", () => {
    const gesture = beginGesture({ boxes: boxes(), selectedIds: ["a", "b"], page }, { x: 150, y: 150 }, null)!;
    const moved = applyGesture(gesture, { x: 160, y: 140 }, page);
    const requests = gestureCommitRequests(moved, 2, 960);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual({ slideIndex: 2, sourceId: "a", xPx: 110, yPx: 90, wPx: 100, hPx: 100, rotationDeg: 0, fitWidthPx: 960 });
    expect(requests[1]).toMatchObject({ sourceId: "b", xPx: 310, yPx: 90 });
  });

  it("flags an unmoved gesture as a no-op so a click never commits", () => {
    const click = beginGesture({ boxes: boxes(), selectedIds: ["a"], page }, { x: 150, y: 150 }, null)!;
    expect(gestureIsNoop(click)).toBe(true);
    const dragged = applyGesture(click, { x: 160, y: 150 }, page);
    expect(gestureIsNoop(dragged)).toBe(false);
    const rotated = applyGesture(beginGesture({ boxes: boxes(), selectedIds: ["a"], page }, { x: 150, y: 76 }, "rotate")!, { x: 250, y: 150 }, page);
    expect(gestureIsNoop(rotated)).toBe(false);
  });

  it("hit-tests a handle only when a selection bounds exists", () => {
    expect(gestureHandleAt(null, { x: 0, y: 0 })).toBeNull();
    expect(gestureHandleAt({ x: 100, y: 100, w: 100, h: 100 }, { x: 200, y: 200 })).toBe("se");
    expect(gestureHandleAt({ x: 100, y: 100, w: 100, h: 100 }, { x: 150, y: 150 })).toBeNull();
  });
});
