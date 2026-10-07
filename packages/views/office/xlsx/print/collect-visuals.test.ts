import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { printableVisuals } from "../visuals/visual-print";
import type { XlsxEditorVisual } from "../visuals/visual-model";
import { collectXlsxPrintSheet } from "./collect";
import { buildXlsxPrintCopy } from "./print-copy";
import type { XlsxPrintableVisuals } from "./print-visuals";

// visual r4 3a: excel-visuals.xlsx printed only its 4x3 table. The ids were
// never the problem (the grid opens the file's sheets under the file's ids);
// every visual sat outside the cells' used range, and print's default range
// was the cells alone. These tests run the real visuals listing through the
// real collector and copy builder, with the file's own sheet ids.

// Every chart / shape SVG the visuals layer renders for a print run.
const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock("react-dom/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/server")>();
  return { ...actual, renderToStaticMarkup: (...args: Parameters<typeof actual.renderToStaticMarkup>) => { renders.count += 1; return actual.renderToStaticMarkup(...args); } };
});

const PLAIN = { bold: false, italic: false, underline: false, strikethrough: false, wrapText: false, diagonalUp: false, diagonalDown: false };
const SHEET = { hidden: false, showGridLines: true, showFormulas: false, showRowColHeaders: true, rightToLeft: false, tabColor: null, defaultRowHeight: null, defaultRowHeightFixed: false, freeze: null, columnWidths: [], pivotTables: [], tables: [], comments: [], pivotRanges: [] };

interface HostOptions {
  readonly definedNames?: readonly unknown[];
  /** Sheet "Other"'s column spans, and the row sizes the model reads (by range). */
  readonly columnWidths?: readonly { readonly startColumn: number; readonly endColumn: number; readonly width?: number; readonly hidden?: boolean }[];
  readonly rows?: readonly { readonly row: number; readonly height?: number; readonly hidden?: boolean }[];
}

function host({ definedNames = [], columnWidths = [], rows = [] }: HostOptions = {}): XlsxGridHostPort {
  return {
    file: {
      sessionId: "s-1", name: "excel-visuals.xlsx", sha256: "a", entryCount: 1,
      // Region | Q1 | Q2 over four rows, as in the fixture.
      sheets: [{ ...SHEET, id: "sheet-1", name: "Data", rowCount: 4, columnCount: 3 }, { ...SHEET, id: "sheet-2", name: "Other", rowCount: 1, columnCount: 1, columnWidths }],
      styles: [PLAIN], dxfStyles: [], visuals: [], definedNames, activeTab: 0, readOnly: false,
    },
    readRange: vi.fn(async ({ range }: { range: { startRow: number; endRow: number } }) => ({
      cells: [{ row: 0, column: 0, value: "Region", styleIndex: 0 }],
      rows: rows.filter((row) => row.row >= range.startRow && row.row <= range.endRow),
      merges: [],
    })),
  } as unknown as XlsxGridHostPort;
}

const anchor = (fromRow: number, fromColumn: number, toRow: number, toColumn: number) => ({ fromRow, fromColumn, fromRowOffset: 0, fromColumnOffset: 0, toRow, toColumn, toRowOffset: 9525 * 5, toColumnOffset: 9525 * 5 });
const chart = { chartType: "column" as const, title: "Doanh thu", series: [{ name: "Q1", categories: ["North", "South"], values: [12.5, 9] }] };
/** The fixture's three visuals, keyed by the file sheet id as seedFileVisuals keys them. */
const VISUALS: XlsxEditorVisual[] = [
  { id: "file-sheet-1-0", sheetId: "sheet-1", file: 0, kind: "chart", anchor: anchor(1, 4, 14, 11), chart, generation: 0 },
  { id: "file-sheet-1-1", sheetId: "sheet-1", file: 1, kind: "picture", anchor: anchor(6, 0, 10, 2), image: { mediaType: "image/png", base64: "iVBORw0KGgo=" }, generation: 0 },
  { id: "file-sheet-1-2", sheetId: "sheet-1", file: 2, kind: "shape", anchor: anchor(13, 0, 16, 2), shape: { shapeType: "roundRect", fillColor: "#70AD47" }, generation: 0 },
  { id: "file-sheet-2-0", sheetId: "sheet-2", file: 0, kind: "shape", anchor: anchor(0, 0, 2, 2), shape: { shapeType: "ellipse", fillColor: "#4472C4" }, generation: 0 },
];

/** getPrintableVisuals as the editor builds it (use-xlsx-visuals), no grid measuring. */
function source(port: XlsxGridHostPort, visuals: readonly XlsxEditorVisual[]): XlsxPrintableVisuals {
  return (sheetId, metricsFor) => printableVisuals(visuals, port.file.sheets, metricsFor ?? (() => null), (kind) => kind, sheetId);
}

async function printCopy(port: XlsxGridHostPort, sheetName: string, sheetId: string, visuals: readonly XlsxEditorVisual[] = VISUALS) {
  const collected = await collectXlsxPrintSheet({ host: port, sheetName, sheetId, snapshot: null, title: "Book", visuals: source(port, visuals) });
  if (!collected.ok) throw new Error(collected.reason);
  const copy = buildXlsxPrintCopy(collected.sheet);
  if (!copy.ok) throw new Error(copy.reason);
  return { sheet: collected.sheet, html: copy.html };
}

describe("print copy visuals (real listing, real ids)", () => {
  // The app stylesheet the overlay SVG resolves its token classes in.
  beforeEach(() => {
    renders.count = 0;
    const style = document.createElement("style");
    style.textContent = ".fill-primary{fill:#2563eb}";
    document.head.appendChild(style);
  });
  afterEach(() => { document.head.innerHTML = ""; });

  it("grows the default print range over the sheet's charts, pictures and shapes so they print", async () => {
    const { sheet, html } = await printCopy(host(), "Data", "sheet-1");
    // Cells end at C4; the chart reaches L15 and the shape row 17.
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 16, startColumn: 0, endColumn: 11 }]);
    expect(html).toContain('class="vis"');
    expect(html).toContain('<img class="pic" alt="picture" src="data:image/png;base64,iVBORw0KGgo="');
    // 12 columns run onto a second portrait page: the chart prints on both.
    expect([...html.matchAll(/<img class="pic" alt="([^"]*)"/g)].map((match) => match[1])).toEqual(["Doanh thu", "picture", "shape", "Doanh thu"]);
    expect(html).toContain('alt="Doanh thu" src="data:image/svg+xml;charset=utf-8,');
    // The overlay SVG has no xmlns (it renders inline in HTML); the printed
    // data: SVG must still be SVG all the way down, or the image draws nothing.
    const chartSrc = /alt="Doanh thu" src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(html)![1]!;
    const markup = decodeURIComponent(chartSrc);
    expect(markup).not.toContain('xmlns=""');
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    expect([...parsed.querySelectorAll("*")].every((element) => element.namespaceURI === "http://www.w3.org/2000/svg")).toBe(true);
    expect(parsed.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("prints only the printed sheet's visuals", async () => {
    const { sheet, html } = await printCopy(host(), "Other", "sheet-2");
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 }]);
    expect(html.match(/<img class="pic"/g)).toHaveLength(1);
    expect(html).not.toContain("Doanh thu");
  });

  it("keeps an explicit print area as set: a visual outside it does not print", async () => {
    const { sheet, html } = await printCopy(host({ definedNames: [{ name: "_xlnm.Print_Area", formula: "Data!$A$1:$C$4", sheetIndex: 0 }] }), "Data", "sheet-1");
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 }]);
    expect(html).not.toContain('class="vis"');
  });

  it("renders each chart and shape SVG once per print, not once more for the range", async () => {
    await printCopy(host(), "Data", "sheet-1");
    // sheet-1 draws one chart and one shape (the picture is a data URL).
    expect(renders.count).toBe(2);
  });
});

// review-delta-r5 M1: oneCell and absolute anchors carry their size as an
// extent (and an absolute one its position); the anchor alone is the from
// cell or the zero anchor. The range grows over the box they draw, measured
// in print's own sizes. Defaults: columns 61 px, rows 20 px.
const ZERO = { fromRow: 0, fromColumn: 0, fromRowOffset: 0, fromColumnOffset: 0, toRow: 0, toColumn: 0, toRowOffset: 0, toColumnOffset: 0 };
const PNG = { mediaType: "image/png" as const, base64: "iVBORw0KGgo=" };
/** A oneCell picture at B3, 254 x 205 px: x 61..315 (into F), y 40..245 (into row 13). */
const ONE_CELL: XlsxEditorVisual = { id: "file-sheet-2-0", sheetId: "sheet-2", file: 0, kind: "picture", anchor: { ...ZERO, fromRow: 2, fromColumn: 1, toRow: 2, toColumn: 1 }, extent: { cx: 9525 * 254, cy: 9525 * 205 }, image: PNG, generation: 0 };
/** An absolute picture at (488, 800) px = I41, 100 x 40 px: ends in J, exactly on row 43's top edge. */
const ABSOLUTE: XlsxEditorVisual = { id: "file-sheet-2-1", sheetId: "sheet-2", file: 1, kind: "picture", anchor: ZERO, position: { x: 9525 * 488, y: 9525 * 800 }, extent: { cx: 9525 * 100, cy: 9525 * 40 }, image: PNG, generation: 0 };

describe("print range over oneCell and absolute visuals", () => {
  it("grows over a oneCell visual's extent, not just its from cell", async () => {
    const { sheet, html } = await printCopy(host(), "Other", "sheet-2", [ONE_CELL]);
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 12, startColumn: 0, endColumn: 5 }]);
    expect(html.match(/<img class="pic"/g)).toHaveLength(1);
  });

  it("grows over an absolute visual's position and extent (an edge-aligned end does not take the next row)", async () => {
    const { sheet, html } = await printCopy(host(), "Other", "sheet-2", [ABSOLUTE]);
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 41, startColumn: 0, endColumn: 9 }]);
    expect(html).toContain('<img class="pic" alt="picture"');
  });

  it("measures the extent with hidden rows and columns taking no room", async () => {
    // C:D hidden, rows 6-15 hidden: x 61..315 now ends in H, y 40..245 in row 23.
    const port = host({ columnWidths: [{ startColumn: 2, endColumn: 3, hidden: true }], rows: Array.from({ length: 10 }, (_, index) => ({ row: 5 + index, hidden: true })) });
    const { sheet } = await printCopy(port, "Other", "sheet-2", [ONE_CELL]);
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 22, startColumn: 0, endColumn: 7 }]);
  });

  it("takes the sizes the grid paints over the file's", async () => {
    // The grid hides C:D and rows 6-15 (a session edit the file does not hold yet).
    const readPrintRange = vi.fn((_sheetId: string, range: { startRow: number; endRow: number; startColumn: number; endColumn: number }) => ({
      styles: [],
      rows: Array.from({ length: range.endRow - range.startRow + 1 }, (_, offset) => ({ height: 20, hidden: range.startRow + offset >= 5 && range.startRow + offset <= 14 })),
      columns: Array.from({ length: range.endColumn - range.startColumn + 1 }, (_, offset) => ({ width: 61, hidden: [2, 3].includes(range.startColumn + offset) })),
      merges: [],
    }));
    const port = host();
    const collected = await collectXlsxPrintSheet({ host: port, sheetName: "Other", sheetId: "sheet-2", snapshot: null, grid: { readPrintRange }, title: "Book", visuals: source(port, [ONE_CELL]) });
    if (!collected.ok) throw new Error(collected.reason);
    expect(collected.sheet.areas).toEqual([{ startRow: 0, endRow: 22, startColumn: 0, endColumn: 7 }]);
  });

  it("measures the extent with taller rows and wider columns", async () => {
    // B is 122 px wide, rows 3-4 are 60 px: x 61..315 ends in E, y 40..245 in row 9.
    const port = host({ columnWidths: [{ startColumn: 1, endColumn: 1, width: 17.43 }], rows: [{ row: 2, height: 45 }, { row: 3, height: 45 }] });
    const { sheet } = await printCopy(port, "Other", "sheet-2", [ONE_CELL]);
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 8, startColumn: 0, endColumn: 4 }]);
  });

  it("leaves a stray far-off visual out of the range instead of refusing the print (review m2)", async () => {
    const stray: XlsxEditorVisual = { ...ONE_CELL, id: "file-sheet-2-2", file: 2, anchor: { ...ZERO, fromRow: 1_000_000, toRow: 1_000_000 } };
    const strayTwoCell: XlsxEditorVisual = { ...VISUALS[3]!, id: "file-sheet-2-3", file: 3, anchor: anchor(0, 0, 2_000_000, 2) };
    const { sheet, html } = await printCopy(host(), "Other", "sheet-2", [VISUALS[3]!, stray, strayTwoCell]);
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 }]);
    // The ellipse prints; the stray picture lies past the printed rows.
    expect(html).not.toContain('alt="picture"');
  });

  it("bounds a whole-column print area by the drawn extent too, as the default range (review m1)", async () => {
    const port = host({ definedNames: [{ name: "_xlnm.Print_Area", formula: "Other!$A:$C", sheetIndex: 1 }] });
    const { sheet, html } = await printCopy(port, "Other", "sheet-2", [ONE_CELL]);
    // Columns as set, rows down to the picture's end; the part right of C is clipped.
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 12, startColumn: 0, endColumn: 2 }]);
    expect(html).toContain('<img class="pic" alt="picture"');
  });
});
