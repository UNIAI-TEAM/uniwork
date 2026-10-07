import { describe, expect, it } from "vitest";
import { gridSheetMetrics, printBox, printableVisuals, type XlsxPrintSheetMetrics } from "./visual-print";
import type { XlsxEditorVisual, XlsxVisualGeometry } from "./visual-model";
import { collectPrintPictures } from "../print/print-visuals";

const ANCHOR = { fromRow: 1, fromColumn: 2, fromRowOffset: 9525 * 4, fromColumnOffset: 9525 * 10, toRow: 3, toColumn: 4, toRowOffset: 0, toColumnOffset: 9525 * 6 };
/** Columns 64 px, rows 20 px, column 3 hidden. */
const METRICS: XlsxPrintSheetMetrics = { columnWidth: (column) => (column === 3 ? 0 : 64), rowHeight: () => 20 };
const SHEETS = [{ id: "s1", name: "Data" }, { id: "s2", name: "Report" }];
const visual = (id: string, extra: Partial<XlsxEditorVisual>): XlsxEditorVisual => ({ id, sheetId: "s1", anchor: ANCHOR, generation: 0, ...extra });

describe("printBox", () => {
  it("places a two-cell anchor in sheet px at 100% (hidden columns take no room), and oneCell / absolute anchors by their extent", () => {
    expect(printBox(visual("a", {}), METRICS)).toEqual({ x: 138, y: 24, width: 64 + 6 - 10, height: 36 });
    expect(printBox(visual("b", { extent: { cx: 9525 * 100, cy: 9525 * 50 } }), METRICS)).toEqual({ x: 138, y: 24, width: 100, height: 50 });
    expect(printBox(visual("c", { position: { x: 9525 * 5, y: 9525 * 7 }, extent: { cx: 9525 * 10, cy: 9525 * 20 } }), METRICS)).toEqual({ x: 5, y: 7, width: 10, height: 20 });
  });
});

describe("printableVisuals", () => {
  const chart = { chartType: "column" as const, title: "Doanh thu", series: [{ name: "Q1", categories: ["N", "S"], values: [1, 2] }] };
  const visuals = [
    visual("chart", { file: 0, kind: "chart", chart }),
    visual("other", { file: 1, kind: "other" }),
    visual("big", { file: 2, kind: "picture" }),
    visual("pic", { image: { mediaType: "image/png", base64: "AAAA" } }),
    visual("shape", { sheetId: "s2", shape: { shapeType: "ellipse", fillColor: "#4472C4" } }),
  ];

  it("lists one sheet's drawn visuals in paint order with an SVG for charts, a data URL for pictures and a frame for unpreviewed ones", () => {
    const list = printableVisuals(visuals, SHEETS, () => METRICS, "s1");
    expect(list.map((entry) => [entry.kind, entry.zIndex, entry.image?.type ?? null])).toEqual([["chart", 0, "svg"], ["picture", 1, null], ["picture", 2, "dataUrl"]]);
    expect(list[0]).toMatchObject({ sheetId: "s1", sheetName: "Data", title: "Doanh thu", anchor: ANCHOR, box: { x: 138, y: 24 } });
    expect(list[0]?.image).toMatchObject({ type: "svg", svg: expect.stringMatching(/^<svg[\s\S]*Doanh thu[\s\S]*<\/svg>$/) });
    expect(list[2]?.image).toEqual({ type: "dataUrl", mediaType: "image/png", dataUrl: "data:image/png;base64,AAAA" });
  });

  it("covers every sheet without a filter and leaves box null where a sheet has no sizes", () => {
    const list = printableVisuals(visuals, SHEETS, (id) => (id === "s1" ? METRICS : null));
    const shape = list.find((entry) => entry.sheetId === "s2");
    expect(shape).toMatchObject({ kind: "shape", sheetName: "Report", zIndex: 0, box: null, image: { type: "svg" } });
  });

  it("feeds print's collector as its source: an untitled visual is labelled by its kind", () => {
    const pictures = collectPrintPictures({
      source: (sheetId, metricsFor) => printableVisuals(visuals, SHEETS, metricsFor ?? (() => METRICS), sheetId),
      sheetIds: ["s1"],
      columnWidth: () => 48,
      rowHeight: () => 15,
      // No defaultView: jsdom's getComputedStyle throws on the chart SVG's nodes.
      document: document.implementation.createHTMLDocument(""),
    });
    expect(pictures.map((picture) => [picture.title, picture.src?.slice(0, 22) ?? null])).toEqual([
      ["Doanh thu", "data:image/svg+xml;cha"],
      ["picture", null],
      ["picture", "data:image/png;base64,"],
    ]);
  });

  it("reads 100% sizes from the live grid's cell boxes, independent of zoom", () => {
    const geometry: XlsxVisualGeometry = {
      getCellBox: (sheet, row, column) => (sheet === "s1" ? { x: -500 + column * 128, y: row * 40, width: column === 1 ? 0 : 128, height: 40, zoom: 2 } : null),
      cellAtPoint: () => null,
    };
    const metrics = gridSheetMetrics(geometry, "s1")!;
    expect([metrics.columnWidth(0), metrics.columnWidth(1), metrics.rowHeight(7)]).toEqual([64, 0, 20]);
    expect(gridSheetMetrics(geometry, "s2")).toBeNull();
  });
});
