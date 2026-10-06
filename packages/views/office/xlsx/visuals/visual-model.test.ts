import { describe, expect, it } from "vitest";
import {
  moveVisualOp,
  EMU_PER_PX,
  MIN_VISUAL_PX,
  anchorFromBox,
  boxFromAnchor,
  dragBox,
  insertBoxAt,
  nudgeBox,
  removeVisualOp,
  setVisualOp,
  visualKind,
  type XlsxEditorVisual,
  type XlsxVisualBox,
  type XlsxVisualGeometry,
} from "./visual-model";

const COL = 64;
const ROW = 20;
const ORIGIN = { x: 40, y: 24 };

/** A uniform grid on sheet "s1": 64 x 20 cells from (40, 24), scaled by zoom. */
function fakeGeometry(zoom = 1): XlsxVisualGeometry {
  return {
    getCellBox(sheetId, row, column) {
      if (sheetId !== "s1") return null;
      return { x: ORIGIN.x + column * COL * zoom, y: ORIGIN.y + row * ROW * zoom, width: COL * zoom, height: ROW * zoom, zoom };
    },
    cellAtPoint(sheetId, x, y) {
      if (sheetId !== "s1" || x < ORIGIN.x || y < ORIGIN.y) return null;
      const ux = (x - ORIGIN.x) / zoom;
      const uy = (y - ORIGIN.y) / zoom;
      const column = Math.floor(ux / COL);
      const row = Math.floor(uy / ROW);
      return { row, column, offsetX: ux - column * COL, offsetY: uy - row * ROW };
    },
  };
}

describe.each([1, 2])("anchor <-> box round trip at zoom %i", (zoom) => {
  it("returns the same box after box -> anchor -> box", () => {
    const geometry = fakeGeometry(zoom);
    const box: XlsxVisualBox = { x: 40 + 70 * zoom, y: 24 + 30 * zoom, width: 150 * zoom, height: 55 * zoom };
    const anchor = anchorFromBox(geometry, "s1", box);
    expect(anchor).toMatchObject({ fromColumn: 1, fromRow: 1, toColumn: 3, toRow: 4 });
    expect(boxFromAnchor(geometry, "s1", anchor!)).toEqual(box);
  });
});

describe("anchorFromBox / boxFromAnchor edge cases", () => {
  it("widens an empty extent by one pixel so the anchor ends below and right", () => {
    const anchor = anchorFromBox(fakeGeometry(), "s1", { x: 40, y: 24, width: 0, height: 0 })!;
    expect(anchor.toColumn).toBe(anchor.fromColumn);
    expect(anchor.toColumnOffset).toBeGreaterThan(anchor.fromColumnOffset);
    expect(anchor.toRowOffset).toBeGreaterThan(anchor.fromRowOffset);
  });

  it("keeps the end past the start inside one cell", () => {
    const anchor = anchorFromBox(fakeGeometry(), "s1", { x: 50, y: 30, width: 10, height: 5 })!;
    expect(anchor.toColumnOffset - anchor.fromColumnOffset).toBe(10 * EMU_PER_PX);
    expect(anchor.toRowOffset - anchor.fromRowOffset).toBe(5 * EMU_PER_PX);
  });

  it("returns null on a sheet the renderer does not measure", () => {
    const geometry = fakeGeometry();
    const box = { x: 50, y: 30, width: 10, height: 10 };
    expect(anchorFromBox(geometry, "other", box)).toBeNull();
    const anchor = anchorFromBox(geometry, "s1", box)!;
    expect(boxFromAnchor(geometry, "other", anchor)).toBeNull();
  });

  it("returns null when a corner falls outside the grid", () => {
    expect(anchorFromBox(fakeGeometry(), "s1", { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
  });
});

describe("insertBoxAt", () => {
  it("places an unzoomed size at the cell and scales it by the zoom", () => {
    expect(insertBoxAt(fakeGeometry(2), "s1", { row: 2, column: 1 }, { width: 100, height: 50 })).toEqual({
      x: 40 + 128,
      y: 24 + 80,
      width: 200,
      height: 100,
    });
  });

  it("returns null for a foreign sheet", () => {
    expect(insertBoxAt(fakeGeometry(), "other", { row: 0, column: 0 }, { width: 1, height: 1 })).toBeNull();
  });
});

describe("nudgeBox", () => {
  const box: XlsxVisualBox = { x: 100, y: 100, width: 50, height: 40 };

  it("moves by the step on arrow keys", () => {
    expect(nudgeBox(box, "ArrowRight", false, 8)).toEqual({ ...box, x: 108 });
    expect(nudgeBox(box, "ArrowLeft", false, 8)).toEqual({ ...box, x: 92 });
    expect(nudgeBox(box, "ArrowDown", false, 8)).toEqual({ ...box, y: 108 });
    expect(nudgeBox(box, "ArrowUp", false, 8)).toEqual({ ...box, y: 92 });
  });

  it("resizes instead of moving when asked and clamps to the minimum", () => {
    expect(nudgeBox(box, "ArrowRight", true, 8)).toEqual({ ...box, width: 58 });
    expect(nudgeBox({ ...box, width: 14 }, "ArrowLeft", true, 8)).toMatchObject({ width: MIN_VISUAL_PX });
    expect(nudgeBox({ ...box, height: 14 }, "ArrowUp", true, 8)).toMatchObject({ height: MIN_VISUAL_PX });
  });

  it("ignores other keys", () => {
    expect(nudgeBox(box, "a", false, 8)).toBeNull();
  });
});

describe("dragBox", () => {
  const start: XlsxVisualBox = { x: 100, y: 100, width: 80, height: 60 };

  it("moves the whole box without a handle", () => {
    expect(dragBox(start, null, 30, -10)).toEqual({ x: 130, y: 90, width: 80, height: 60 });
  });

  it("resizes from the opposite corner for each handle", () => {
    expect(dragBox(start, "se", 10, 20)).toEqual({ x: 100, y: 100, width: 90, height: 80 });
    expect(dragBox(start, "nw", 10, 20)).toEqual({ x: 110, y: 120, width: 70, height: 40 });
    expect(dragBox(start, "ne", 10, 20)).toEqual({ x: 100, y: 120, width: 90, height: 40 });
    expect(dragBox(start, "sw", 10, 20)).toEqual({ x: 110, y: 100, width: 70, height: 80 });
  });

  it("clamps at the minimum size and keeps the opposite corner fixed", () => {
    expect(dragBox(start, "se", -500, -500)).toEqual({ x: 100, y: 100, width: MIN_VISUAL_PX, height: MIN_VISUAL_PX });
    expect(dragBox(start, "nw", 500, 500)).toEqual({
      x: 180 - MIN_VISUAL_PX,
      y: 160 - MIN_VISUAL_PX,
      width: MIN_VISUAL_PX,
      height: MIN_VISUAL_PX,
    });
  });
});

describe("wire ops", () => {
  const anchor = { fromRow: 0, fromColumn: 0, fromRowOffset: 0, fromColumnOffset: 0, toRow: 3, toColumn: 3, toRowOffset: 0, toColumnOffset: 0 };
  const base = { id: "v1", sheetId: "s1", anchor, generation: 1, saved: false } as const;
  const chart = { chartType: "pie", title: "T", series: [] } as const;
  const shape = { shapeType: "rect" } as const;
  const image = { mediaType: "image/png", base64: "AAAA" } as const;

  it("emits set_visual with the body matching the visual kind", () => {
    const chartVisual: XlsxEditorVisual = { ...base, chart };
    const shapeVisual: XlsxEditorVisual = { ...base, shape };
    const imageVisual: XlsxEditorVisual = { ...base, image };
    expect(setVisualOp(chartVisual, "Data")).toEqual({ op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor, chart } });
    expect(setVisualOp(shapeVisual, "Data")).toEqual({ op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor, shape } });
    expect(setVisualOp(imageVisual, "Data")).toEqual({ op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor, image } });
  });

  it("emits a move as the anchor-only set_visual, never re-sending the body", () => {
    expect(moveVisualOp({ ...base, image }, "Data")).toEqual({ op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor } });
  });

  it("emits remove_visual with the id only", () => {
    expect(removeVisualOp({ ...base, chart }, "Data")).toEqual({ op: "remove_visual", target: { sheet: "Data" }, attributes: { id: "v1" } });
  });

  it("names the visual kind", () => {
    expect(visualKind({ chart })).toBe("chart");
    expect(visualKind({ shape })).toBe("shape");
    expect(visualKind({})).toBe("picture");
  });
});
