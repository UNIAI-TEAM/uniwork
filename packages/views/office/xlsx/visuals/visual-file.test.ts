import { describe, expect, it } from "vitest";
import type { XlsxRenderModel } from "@uniwork/office-engine/xlsx";
import { createXlsxModelHost } from "../xlsx-render-model-bridge";
import { applySavedVisuals, boxOfVisual, seedFileVisuals } from "./visual-file";
import { moveVisualOp, removeVisualOp, type XlsxEditorVisual, type XlsxVisualGeometry } from "./visual-model";
import { fileEditsFromStream } from "./visual-recovery";

const ANCHOR = { fromRow: 1, fromColumn: 1, fromRowOffset: 0, fromColumnOffset: 0, toRow: 4, toColumn: 3, toRowOffset: 0, toColumnOffset: 0 };
const fileVisual = (sheetId: string, file: number, extra: Partial<XlsxEditorVisual> = {}): XlsxEditorVisual => ({
  id: `file-${sheetId}-${file}`, sheetId, file, anchor: ANCHOR, generation: 0, kind: "shape", ...extra,
});
const session = (id: string, sheetId: string, generation: number): XlsxEditorVisual => ({ id, sheetId, anchor: ANCHOR, generation, shape: { shapeType: "rect" } });

describe("seedFileVisuals", () => {
  it("keeps every anchor (so indexes stay the gateway's) and draws unknown presets as rectangles", () => {
    const seeded = seedFileVisuals({
      s1: [
        { index: 0, kind: "shape", editable: true, anchor: ANCHOR, shape: { shapeType: "star5", fillColor: "#FF0000" } },
        { index: 1, kind: "other", editable: false },
        { index: 2, kind: "picture", editable: false, anchor: ANCHOR, extent: { cx: 9525, cy: 9525 } },
      ],
    });
    expect(seeded.map((visual) => [visual.id, visual.file, visual.kind, visual.fixed ?? false])).toEqual([
      ["file-s1-0", 0, "shape", false],
      ["file-s1-1", 1, "other", true],
      ["file-s1-2", 2, "picture", true],
    ]);
    expect(seeded[0]?.shape).toEqual({ shapeType: "rect", fillColor: "#FF0000" });
    expect(seeded[2]?.extent).toEqual({ cx: 9525, cy: 9525 });
  });
});

describe("boxOfVisual", () => {
  const geometry: XlsxVisualGeometry = {
    getCellBox: (_sheet, row, column) => ({ x: 10 + column * 50, y: 5 + row * 20, width: 50, height: 20, zoom: 2 }),
    cellAtPoint: () => null,
  };

  it("sizes a oneCell anchor from its start cell and an absolute one from the sheet origin, zoom applied", () => {
    expect(boxOfVisual(geometry, fileVisual("s1", 0, { anchor: { ...ANCHOR, fromColumnOffset: 9525 }, extent: { cx: 95250, cy: 47625 } }))).toEqual({ x: 62, y: 25, width: 20, height: 10 });
    expect(boxOfVisual(geometry, fileVisual("s1", 0, { position: { x: 19050, y: 9525 }, extent: { cx: 9525, cy: 9525 } }))).toEqual({ x: 14, y: 7, width: 2, height: 2 });
  });
});

describe("applySavedVisuals", () => {
  it("drops the saved deletes, moves later anchors up and appends what the save wrote, per sheet", () => {
    const visuals = [
      fileVisual("s1", 0), fileVisual("s1", 2), fileVisual("s1", 3), fileVisual("s2", 0),
      session("a", "s1", 3), session("b", "s2", 2), session("late", "s1", 9),
    ];
    const removals = [{ sheetId: "s1", file: 1, generation: 2 }, { sheetId: "s1", file: 4, generation: 9 }];
    const result = applySavedVisuals(visuals, removals, 5);
    expect(result.visuals.map((visual) => [visual.id, visual.file])).toEqual([
      ["file-s1-0", 0], ["file-s1-2", 1], ["file-s1-3", 2], ["file-s2-0", 0],
      ["a", 3], ["b", 1], ["late", undefined],
    ]);
    expect(result.removals).toEqual([{ sheetId: "s1", file: 4, generation: 9 }]);
  });

  it("numbers a sheet's first drawing from 0 and leaves the list alone when the save carried nothing visual", () => {
    expect(applySavedVisuals([session("a", "s1", 1), session("b", "s1", 1)], [], 1).visuals.map((visual) => visual.file)).toEqual([0, 1]);
    const untouched = [fileVisual("s1", 0), session("x", "s1", 0)];
    expect(applySavedVisuals(untouched, [], 4).visuals).toEqual(untouched);
  });

  it("appends after the render model's trailing slot when the drawing ran past the listing cap (review-visuals V2)", () => {
    const seeded = seedFileVisuals({ s1: [{ index: 0, kind: "shape", editable: true, anchor: ANCHOR }, { index: 1_499, kind: "other", editable: false }] });
    const result = applySavedVisuals([...seeded, session("a", "s1", 1)], [], 1);
    expect(result.visuals.find((visual) => visual.id === "a")?.file).toBe(1_500);
  });

  it("keeps a visual a save wrote on a sheet whose drawing could not be read fixed, never numbered (review-visuals V2)", () => {
    const seeded = seedFileVisuals({ s1: [{ index: -1, kind: "other", editable: false, unread: true }] });
    expect(seeded[0]).toMatchObject({ file: -1, kind: "other", fixed: true, unread: true });
    const result = applySavedVisuals([...seeded, session("a", "s1", 1), session("b", "s2", 1)], [], 1);
    const written = result.visuals.find((visual) => visual.id === "a");
    expect(written?.fixed).toBe(true);
    expect(written?.file).toBeUndefined();
    expect(result.visuals.find((visual) => visual.id === "b")).toMatchObject({ file: 0 });
    expect(result.visuals.find((visual) => visual.id === "b")?.fixed).toBeUndefined();
  });

  it("addresses a file visual's ops by index, never by id", () => {
    expect(moveVisualOp(fileVisual("s1", 2), "Data")).toEqual({ op: "set_visual", target: { sheet: "Data" }, attributes: { file: 2, anchor: ANCHOR } });
    expect(removeVisualOp(fileVisual("s1", 2), "Data")).toEqual({ op: "remove_visual", target: { sheet: "Data" }, attributes: { file: 2 } });
  });
});

describe("fileEditsFromStream", () => {
  it("folds file moves and deletes per index, follows renames and drops a removed sheet's edits", () => {
    const at = (fromRow: number) => ({ ...ANCHOR, fromRow });
    expect(fileEditsFromStream([
      { op: "set_visual", target: { sheet: "Data" }, attributes: { file: 0, anchor: at(2) } },
      { op: "set_visual", target: { sheet: "Data" }, attributes: { file: 0, anchor: at(5) } },
      { op: "remove_visual", target: { sheet: "Data" }, attributes: { file: 1 } },
      { op: "set_visual", target: { sheet: "Data" }, attributes: { file: 1, anchor: at(9) } },
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor: at(1) } },
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Doanh thu" } },
      { op: "remove_visual", target: { sheet: "Old" }, attributes: { file: 0 } },
      { op: "remove_sheet", target: { sheet: "Old" } },
      { op: "set_visual", target: { sheet: "Doanh thu" }, attributes: { file: -1, anchor: at(1) } },
    ])).toEqual([
      { sheetName: "Doanh thu", file: 0, anchor: at(5) },
      // A move after its delete is the undo of that delete: a restore (14e02958).
      { sheetName: "Doanh thu", file: 1, anchor: at(9) },
    ]);
  });
});

describe("createXlsxModelHost", () => {
  it("exposes the render model's file visuals per sheet id", () => {
    const visuals = [{ index: 0, kind: "shape" as const, editable: true, anchor: ANCHOR, shape: { shapeType: "rect" } }];
    const model: XlsxRenderModel = {
      revision: 1,
      activeTab: 0,
      date1904: false,
      styles: [],
      dxfStyles: [],
      sheets: [
        { id: "sheet-1", name: "Data", rowCount: 1, columnCount: 1, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [], cells: {}, visuals },
        { id: "sheet-2", name: "Empty", rowCount: 1, columnCount: 1, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [], cells: {} },
      ],
    };
    expect(createXlsxModelHost(model, { sessionId: "s", name: "a.xlsx", sha256: "x" }).fileVisuals).toEqual({ "sheet-1": visuals });
  });
});
