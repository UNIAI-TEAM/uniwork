import { describe, expect, it, vi } from "vitest";
import type { XlsxRenderStyle, XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import type { XlsxGridHostPort } from "../xlsx-grid-surface";
import { collectXlsxPrintSheet } from "./collect";
import { parsePrintRange, parseTitleRows, resolvePrintSetup } from "./print-setup";

const PLAIN: XlsxRenderStyle = { bold: false, italic: false, underline: false, strikethrough: false, wrapText: false, diagonalUp: false, diagonalDown: false };

function host(overrides: Record<string, unknown> = {}): XlsxGridHostPort {
  return {
    file: {
      sessionId: "s-1",
      name: "Book.xlsx",
      sha256: "a",
      entryCount: 1,
      sheets: [
        { id: "sheet-1", name: "Data", rowCount: 3, columnCount: 2, hidden: false, showGridLines: true, showFormulas: false, showRowColHeaders: true, rightToLeft: false, tabColor: null, defaultRowHeight: 20, defaultRowHeightFixed: false, freeze: null, columnWidths: [{ startColumn: 1, endColumn: 1, width: 20 }], pivotTables: [], tables: [], comments: [], pivotRanges: [], pageSetup: { orientation: "landscape" } },
        { id: "sheet-2", name: "Other", rowCount: 1, columnCount: 1, hidden: false, showGridLines: true, showFormulas: false, showRowColHeaders: true, rightToLeft: false, tabColor: null, defaultRowHeight: null, defaultRowHeightFixed: false, freeze: null, columnWidths: [], pivotTables: [], tables: [], comments: [], pivotRanges: [] },
      ],
      styles: [PLAIN, { ...PLAIN, numberFormat: "#,##0.00" }],
      dxfStyles: [],
      visuals: [],
      definedNames: [],
      activeTab: 0,
      readOnly: false,
      ...overrides,
    },
    readRange: vi.fn(async () => ({
      cells: [{ row: 0, column: 0, value: "file", styleIndex: 0 }, { row: 1, column: 1, value: 1234.5, styleIndex: 1 }],
      rows: [{ row: 2, hidden: true }],
      merges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }],
    })),
  } as unknown as XlsxGridHostPort;
}

const live: XlsxWorkbookSnapshot = { revision: 2, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: "edited" }, B2: { value: 1234.5 }, C5: { value: "beyond" } } }] };

describe("collectXlsxPrintSheet", () => {
  it("takes display text from the mounted grid and layout from the host", async () => {
    const port = host();
    const grid = { readRangeValues: vi.fn(() => ({ values: [], display: [["Grid A1", ""], ["", "1,234.50 ₫"]] })) };
    const result = await collectXlsxPrintSheet({ host: port, sheetName: "Data", sheetId: "sheet-1", snapshot: live, grid, title: "Book" });
    if (!result.ok) throw new Error(result.reason);
    const { sheet } = result;
    // The used range grows to the live cell C5 beyond the file's dimension.
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 }]);
    expect(port.readRange).toHaveBeenCalledWith({ sessionId: "s-1", sheetId: "sheet-1", range: sheet.areas[0] });
    expect(sheet.cells.get("0:0")).toEqual({ text: "Grid A1", kind: "text", styleIndex: 0 });
    expect(sheet.cells.get("1:1")).toEqual({ text: "1,234.50 ₫", kind: "number", styleIndex: 1 });
    expect(sheet.setup.orientation).toBe("landscape");
    expect(sheet.rows.get(2)).toEqual({ hidden: true });
    expect(sheet.columns.get(1)).toEqual({ width: 105 });
    expect(sheet.defaultRowHeight).toBe(20);
    expect(sheet.merges).toHaveLength(1);
  });

  it("formats the live value itself without a grid", async () => {
    const result = await collectXlsxPrintSheet({ host: host(), sheetName: "Data", snapshot: live, title: "Book" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.sheet.cells.get("0:0")?.text).toBe("edited");
    expect(result.sheet.cells.get("1:1")?.text).toBe("1,234.50");
    expect(result.sheet.cells.get("4:2")?.text).toBe("beyond");
  });

  it("prints a date-formatted serial as a date without a grid (R9)", async () => {
    const port = host({ styles: [PLAIN, { ...PLAIN, numberFormat: "dd/mm/yyyy" }] });
    const dates: XlsxWorkbookSnapshot = { revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells: { B2: { value: 45936.5 } } }] };
    const result = await collectXlsxPrintSheet({ host: port, sheetName: "Data", snapshot: dates, title: "Book" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.sheet.cells.get("1:1")?.text).toBe("2025-10-06 12:00");
    const old = host({ styles: [PLAIN, { ...PLAIN, numberFormat: "yyyy-mm-dd" }], date1904: true });
    const day: XlsxWorkbookSnapshot = { revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells: { B2: { value: 0 } } }] };
    const oldResult = await collectXlsxPrintSheet({ host: old, sheetName: "Data", snapshot: day, title: "Book" });
    if (!oldResult.ok) throw new Error(oldResult.reason);
    expect(oldResult.sheet.cells.get("1:1")?.text).toBe("1904-01-01");
  });

  it("reads a large range in row chunks and yields between them (R5)", async () => {
    const port = host({ definedNames: [{ name: "_xlnm.Print_Area", formula: "Data!$A$1:$J$4500", sheetIndex: 0 }] });
    const grid = { readRangeValues: vi.fn(() => null), readPrintRange: vi.fn(() => null) };
    const result = await collectXlsxPrintSheet({ host: port, sheetName: "Data", snapshot: null, grid, title: "Book" });
    expect(result.ok).toBe(true);
    // 10 columns -> 2,000 rows (20,000 cells) per chunk.
    const ranges = vi.mocked(port.readRange).mock.calls.map(([call]) => call.range);
    expect(ranges).toEqual([
      { startRow: 0, endRow: 1999, startColumn: 0, endColumn: 9 },
      { startRow: 2000, endRow: 3999, startColumn: 0, endColumn: 9 },
      { startRow: 4000, endRow: 4499, startColumn: 0, endColumn: 9 },
    ]);
    expect(grid.readPrintRange.mock.calls.map((call) => (call as unknown[])[1])).toEqual(ranges);
  });

  it("honours the sheet-scoped print area and reads title rows outside it", async () => {
    const port = host({ definedNames: [
      { name: "_xlnm.Print_Area", formula: "Data!$B$10:$B$12", sheetIndex: 0 },
      { name: "_xlnm.Print_Titles", formula: "Data!$1:$1", sheetIndex: 0 },
    ] });
    const result = await collectXlsxPrintSheet({ host: port, sheetName: "Data", snapshot: null, title: "Book" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.sheet.areas).toEqual([{ startRow: 9, endRow: 11, startColumn: 1, endColumn: 1 }]);
    // The area and the title row are separate reads (R4).
    expect(port.readRange).toHaveBeenCalledWith({ sessionId: "s-1", sheetId: "sheet-1", range: { startRow: 9, endRow: 11, startColumn: 1, endColumn: 1 } });
    expect(port.readRange).toHaveBeenCalledWith({ sessionId: "s-1", sheetId: "sheet-1", range: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 } });
    expect(result.sheet.setup.titleRows).toEqual({ start: 0, end: 0 });
  });

  it("prints the styles, sizes and merges the grid paints (session edits, conditional-format fills)", async () => {
    const port = host();
    const painted = { bold: true, fillColor: "#FFC7CE", fontColor: "#9C0006", borderTop: { style: "thin" }, borderLeft: null };
    const grid = {
      readRangeValues: vi.fn(() => ({ values: [], display: [["Grid A1", ""], ["", "1,234.50"], ["", ""]] })),
      readPrintRange: vi.fn(() => ({
        styles: [[painted, null], [painted, { textRotation: 90 }], [null, null]],
        rows: [{ height: 40, hidden: false }, { height: 20, hidden: true }, { height: 20, hidden: false }],
        columns: [{ width: 100, hidden: false }, { width: 64, hidden: false }],
        merges: [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }],
      })),
    };
    const result = await collectXlsxPrintSheet({ host: port, sheetName: "Data", sheetId: "sheet-1", snapshot: null, grid, title: "Book" });
    if (!result.ok) throw new Error(result.reason);
    const { sheet } = result;
    expect(grid.readPrintRange).toHaveBeenCalledWith("sheet-1", { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 });
    // Live styles are appended after the file's two and shared by equal cells.
    const a1 = sheet.cells.get("0:0")!;
    expect(a1.styleIndex).toBe(2);
    expect(sheet.cells.get("1:0")?.styleIndex).toBe(2);
    expect(sheet.styles[2]).toEqual({ bold: true, italic: false, underline: false, strikethrough: false, wrapText: false, diagonalUp: false, diagonalDown: false, fillColor: "#FFC7CE", fontColor: "#9C0006", borderTop: { style: "thin" } });
    expect(sheet.styles[3]?.textRotation).toBe(90);
    // A cell the grid paints without a style drops the model's style.
    expect(sheet.cells.get("1:1")?.styleIndex).toBe(3);
    expect(sheet.cells.get("0:1")).toBeUndefined();
    expect(sheet.rows.get(0)).toEqual({ height: 30 });
    expect(sheet.rows.get(1)).toEqual({ height: 15, hidden: true });
    expect(sheet.columns.get(0)).toEqual({ width: 75 });
    expect(sheet.merges).toEqual([{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }]);
    expect(sheet.marks).toBeUndefined();
  });

  it("carries the data bars and icons the grid paints, keyed by cell", async () => {
    const bar = { color: "#638EC6", value: 40, startPoint: 0, isGradient: true };
    const grid = {
      readPrintRange: vi.fn(() => ({
        styles: [[null, null], [null, null], [null, null]],
        rows: [], columns: [], merges: [],
        marks: [{ row: 0, column: 1, dataBar: bar }, { row: 2, column: 0, icon: "data:image/svg+xml;charset=utf-8,%3Csvg%3E", hideValue: true }],
      })),
    };
    const result = await collectXlsxPrintSheet({ host: host(), sheetName: "Data", sheetId: "sheet-1", snapshot: null, grid, title: "Book" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.sheet.marks).toEqual(new Map([
      ["0:1", { dataBar: bar }],
      ["2:0", { icon: "data:image/svg+xml;charset=utf-8,%3Csvg%3E", hideValue: true }],
    ]));
  });

  it("reads every area of a multi-area print area with the title rows and columns beside it", async () => {
    const port = host({ definedNames: [
      { name: "_xlnm.Print_Area", formula: "Data!$C$5:$D$6,Data!$F$9", sheetIndex: 0 },
      { name: "_xlnm.Print_Titles", formula: "Data!$A:$A,Data!$1:$1", sheetIndex: 0 },
    ] });
    const now = new Date(2026, 9, 6, 19, 30);
    const result = await collectXlsxPrintSheet({ host: port, sheetName: "Data", snapshot: null, title: "Book", now, locale: "en-GB" });
    if (!result.ok) throw new Error(result.reason);
    expect(result.sheet.areas).toEqual([
      { startRow: 4, endRow: 5, startColumn: 2, endColumn: 3 },
      { startRow: 8, endRow: 8, startColumn: 5, endColumn: 5 },
    ]);
    // Each area, then its title rows, title columns and their corner (R4).
    expect(vi.mocked(port.readRange).mock.calls.map(([call]) => call.range)).toEqual([
      { startRow: 4, endRow: 5, startColumn: 2, endColumn: 3 },
      { startRow: 0, endRow: 0, startColumn: 2, endColumn: 3 },
      { startRow: 4, endRow: 5, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      { startRow: 8, endRow: 8, startColumn: 5, endColumn: 5 },
      { startRow: 0, endRow: 0, startColumn: 5, endColumn: 5 },
      { startRow: 8, endRow: 8, startColumn: 0, endColumn: 0 },
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    ]);
    expect(result.sheet.setup.titleColumns).toEqual({ start: 0, end: 0 });
    expect(result.sheet.headerContext).toEqual({ sheetName: "Data", fileName: "Book.xlsx", date: "06/10/2026", time: "19:30" });
  });

  it("refuses an unknown sheet and a range too large to print", async () => {
    expect(await collectXlsxPrintSheet({ host: host(), sheetName: "Missing", snapshot: null, title: "Book" })).toEqual({ ok: false, reason: "print_no_sheet" });
    const huge = host({ definedNames: [{ name: "_xlnm.Print_Area", formula: "Data!$A$1:$Z$100000", sheetIndex: 0 }] });
    expect(await collectXlsxPrintSheet({ host: huge, sheetName: "Data", snapshot: null, title: "Book" })).toEqual({ ok: false, reason: "print_too_large" });
    expect(huge.readRange).not.toHaveBeenCalled();
    // A small area far below its title row is not a union of the two (R4).
    const far = host({ definedNames: [
      { name: "_xlnm.Print_Area", formula: "Data!$A$300000:$J$300010", sheetIndex: 0 },
      { name: "_xlnm.Print_Titles", formula: "Data!$1:$1", sheetIndex: 0 },
    ] });
    const farResult = await collectXlsxPrintSheet({ host: far, sheetName: "Data", snapshot: null, title: "Book" });
    expect(farResult.ok).toBe(true);
    expect(vi.mocked(far.readRange).mock.calls.map(([call]) => call.range)).toEqual([
      { startRow: 299_999, endRow: 300_009, startColumn: 0, endColumn: 9 },
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 9 },
    ]);
  });
});

describe("print setup references", () => {
  const used = { startRow: 0, endRow: 49, startColumn: 0, endColumn: 9 };

  it("reads cell, column and row references, sheet-qualified and absolute", () => {
    expect(parsePrintRange("'My sheet'!$C$5:$A$2", used)).toEqual({ startRow: 1, endRow: 4, startColumn: 0, endColumn: 2 });
    expect(parsePrintRange("B3", used)).toEqual({ startRow: 2, endRow: 2, startColumn: 1, endColumn: 1 });
    expect(parsePrintRange("Data!$B:$D", used)).toEqual({ startRow: 0, endRow: 49, startColumn: 1, endColumn: 3 });
    expect(parsePrintRange("Data!$2:$4", used)).toEqual({ startRow: 1, endRow: 3, startColumn: 0, endColumn: 9 });
    expect(parsePrintRange("Data!$A$1:$B$2,Data!$D$1:$E$2", used)).toEqual({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
    expect(parsePrintRange("#REF!", used)).toBeNull();
    expect(parseTitleRows("Data!$A:$A,Data!$1:$2")).toEqual({ start: 0, end: 1 });
    expect(parseTitleRows("Data!$A:$A")).toBeNull();
  });

  it("lets a session clear the file's print area and applies margin presets", () => {
    const setup = resolvePrintSetup({
      file: { margins: { left: 1, right: 1, top: 1, bottom: 1 }, paperSize: 999 },
      session: { printArea: null, margins: "narrow" },
      definedNames: [{ name: "_xlnm.Print_Area", formula: "Data!$A$1:$B$2", sheetIndex: 0 }],
      sheetIndex: 0,
      used,
    });
    expect(setup.printAreas).toBeNull();
    expect(setup.margins).toEqual({ left: 0.25, right: 0.25, top: 0.75, bottom: 0.75 });
    // An unknown paper code prints on A4.
    expect(setup.paper.width).toBeCloseTo(8.27, 2);
  });

  it("knows the ISO, JIS, US and envelope paper codes Excel writes (R6)", () => {
    const paper = (paperSize: number, orientation?: "landscape") => resolvePrintSetup({ file: { paperSize, orientation }, sheetIndex: 0, used }).paper;
    const inches = (value: { width: number; height: number }) => [Math.round(value.width * 100) / 100, Math.round(value.height * 100) / 100];
    expect(inches(paper(12))).toEqual([10.12, 14.33]); // JIS B4 257 x 364 mm
    expect(inches(paper(13))).toEqual([7.17, 10.12]); // JIS B5
    expect(inches(paper(70))).toEqual([4.13, 5.83]); // A6
    expect(inches(paper(7))).toEqual([7.25, 10.5]); // Executive
    expect(inches(paper(20))).toEqual([4.13, 9.5]); // #10 envelope
    expect(inches(paper(66, "landscape"))).toEqual([23.39, 16.54]); // A2, turned
  });
});
