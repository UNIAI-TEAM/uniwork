import { describe, expect, it } from "vitest";
import type { XlsxRenderModel } from "@uniwork/office-engine/xlsx";
import { createXlsxModelHost, readRangeFromModel, toRendererWorkbookFile } from "./xlsx-render-model-bridge";

const MODEL: XlsxRenderModel = {
  revision: 3,
  activeTab: 1,
  date1904: true,
  theme: { colors: Array.from({ length: 12 }, (_, i) => `#00000${i.toString(16)}`), majorFont: "Cambria", minorFont: "Calibri" },
  normalFontName: "Calibri",
  styles: [
    {
      fontFamily: "Calibri", fontSize: 11, bold: false, italic: false, underline: false, strikethrough: false,
      wrapText: false, diagonalUp: false, diagonalDown: false, numberFormat: "General",
    },
    {
      fontFamily: "Calibri", fontSize: 11, bold: true, italic: false, underline: false, strikethrough: false,
      wrapText: true, diagonalUp: false, diagonalDown: false, numberFormat: "#,##0.00", fillColor: "#FFF2CC",
    },
  ],
  dxfStyles: [],
  definedNames: [
    { name: "Sales", formula: "Data!$A$1:$B$2" },
    { name: "Scoped", formula: "PhuLuc!$A$1", sheetIndex: 1 },
    { name: "HiddenName", formula: "Data!$A$1", hidden: true },
  ],
  sheets: [
    {
      id: "sheet-1",
      name: "Data",
      rowCount: 100,
      columnCount: 12,
      showGridLines: true,
      showRowColHeaders: true,
      freeze: { frozenRows: 2, frozenColumns: 1 },
      merges: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 }],
      columnWidths: [{ startColumn: 1, endColumn: 1, width: 18, customWidth: true }],
      rowsMeta: [{ row: 0, height: 22, customHeight: true }, { row: 4, hidden: true }],
      hyperlinks: [{ row: 2, column: 0, target: "https://example.com" }],
      cells: {
        A1: { v: "Title", s: 1 },
        B1: { v: 42, s: 1 },
        A2: { f: "=SUM(B1:B2)", c: 42 },
        B2: { v: 1 },
        A5: { v: "hidden-row" },
      },
    },
    {
      id: "sheet-2",
      name: "PhuLuc",
      rowCount: 10,
      columnCount: 4,
      merges: [],
      columnWidths: [],
      rowsMeta: [],
      hyperlinks: [],
      cells: { A1: { v: null } },
    },
  ],
};

describe("render model bridge", () => {
  it("defaults definedNames to an empty list when the model carries none", () => {
    const file = toRendererWorkbookFile({ ...MODEL, definedNames: undefined }, { sessionId: "s-1", name: "book.xlsx", sha256: "c".repeat(64) });
    expect(file.definedNames).toEqual([]);
  });

  it("maps the model onto the vendored WorkbookFile shape", () => {
    const file = toRendererWorkbookFile(MODEL, { sessionId: "s-1", name: "book.xlsx", sha256: "a".repeat(64), fileBytes: 1234, entryCount: 9 });
    expect(file.sessionId).toBe("s-1");
    expect(file.sheets.map((sheet) => sheet.name)).toEqual(["Data", "PhuLuc"]);
    expect(file.sheets[0]!.freeze).toEqual({ frozenRows: 2, frozenColumns: 1 });
    expect(file.sheets[0]!.columnWidths).toEqual([{ startColumn: 1, endColumn: 1, width: 18, customWidth: true }]);
    expect(file.sheets[0]!.showGridLines).toBe(true);
    expect(file.sheets[0]!.defaultRowHeight).toBeNull();
    expect(file.styles).toHaveLength(2);
    expect(file.themeColors).toHaveLength(12);
    expect(file.themeFonts).toEqual({ major: "Cambria", minor: "Calibri" });
    expect(file.normalFontName).toBe("Calibri");
    expect(file.activeTab).toBe(1);
    expect(file.date1904).toBe(true);
    expect(file.readOnly).toBe(false);
    expect(file.visuals).toEqual([]);
    // B7 F1: the file's defined names reach the vendored loader; hidden names
    // keep their reader-only flag so the name manager can preserve them.
    expect(file.definedNames).toEqual([
      { name: "Sales", formula: "Data!$A$1:$B$2" },
      { name: "Scoped", formula: "PhuLuc!$A$1", sheetIndex: 1 },
      { name: "HiddenName", formula: "Data!$A$1", hidden: true },
    ]);
    // The pinned viewport loader iterates these even without table/note features.
    for (const sheet of file.sheets) {
      expect(sheet.tables).toEqual([]);
      expect(sheet.comments).toEqual([]);
      expect(sheet.pivotRanges).toEqual([]);
    }
  });

  it("maps the tables a file ships into the renderer sheet shape", () => {
    const withTable: XlsxRenderModel = {
      ...MODEL,
      sheets: [
        {
          ...MODEL.sheets[0]!,
          tables: [
            {
              name: "Sales",
              area: { startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 },
              columnNames: ["Region", "Q1", "Total"],
              style: "TableStyleMedium2",
              bandedRows: true,
              headerRow: true,
              totalsRow: true,
            },
          ],
        },
        MODEL.sheets[1]!,
      ],
    };
    const file = toRendererWorkbookFile(withTable, { sessionId: "s", name: "n.xlsx", sha256: "x" });
    expect(file.sheets[0]?.tables).toEqual([
      {
        range: { startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 },
        headerRowCount: 1,
        showRowStripes: true,
        showColumnStripes: false,
        name: "Sales",
        columns: ["Region", "Q1", "Total"],
        totalsRowCount: 1,
      },
    ]);
    expect(file.sheets[1]?.tables).toEqual([]);
  });

  it("serves a viewport window with cached formula results and layout", () => {
    const result = readRangeFromModel(MODEL, "Data", { startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 });
    const a2 = result.cells.find((cell) => cell.row === 1 && cell.column === 0)!;
    expect(a2.formula).toBe("=SUM(B1:B2)");
    expect(a2.value).toBe(42);
    const a1 = result.cells.find((cell) => cell.row === 0 && cell.column === 0)!;
    expect(a1.value).toBe("Title");
    expect(a1.styleIndex).toBe(1);
    expect(result.rows.find((row) => row.row === 0)?.height).toBe(22);
    expect(result.rows.find((row) => row.row === 4)?.hidden).toBe(true);
    expect(result.merges).toEqual([{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 }]);
    expect(result.hyperlinks).toEqual([{ row: 2, column: 0, target: "https://example.com" }]);
    expect(result.indexedThroughRow).toBe(99);
    expect(result.indexingComplete).toBe(true);
    // Cells outside the requested window are not materialised.
    expect(result.cells.some((cell) => cell.row === 4 && cell.column === 0)).toBe(true);
    expect(result.cells.some((cell) => cell.column > 1)).toBe(false);
  });

  it("excludes merges and links outside the window", () => {
    const result = readRangeFromModel(MODEL, "sheet-2", { startRow: 5, endRow: 6, startColumn: 0, endColumn: 0 });
    expect(result.merges).toEqual([]);
    expect(result.hyperlinks).toEqual([]);
    expect(result.cells).toEqual([]);
  });

  it("resolves omitted cell styles through row, column and workbook defaults", () => {
    const model = { ...MODEL, sheets: [{ ...MODEL.sheets[0]!,
      rowsMeta: [{ row: 1, styleIndex: 1 }],
      columnWidths: [{ startColumn: 0, endColumn: 0, styleIndex: 1 }],
      cells: { A1: { v: "column" }, B1: { v: "normal" }, A2: { v: "row" }, B2: { v: "explicit", s: 0 } },
    }] };
    const result = readRangeFromModel(model, "Data", { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
    expect(result.cells.map((cell) => cell.styleIndex)).toEqual([1, 0, 1, 0]);
    expect(readRangeFromModel({ ...model, styles: [], sheets: [{ ...model.sheets[0]!, rowsMeta: [], columnWidths: [] }] },
      "Data", { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 }).cells[0]?.styleIndex).toBeUndefined();
  });

  it("returns complete conditional ranges even when the first viewport does not intersect them", () => {
    const rule = { ranges: [{ startRow: 20, endRow: 30, startColumn: 3, endColumn: 3 }],
      ruleType: "cellIs", formulas: ["10"], operator: "lessThan", dxfIndex: 0, priority: 1,
      percent: false, bottom: false, cfvos: [], colors: [], iconReverse: false, showValue: true };
    const model = { ...MODEL, sheets: [{ ...MODEL.sheets[0]!, conditionalRules: [rule] }] };
    const result = readRangeFromModel(model, "Data", { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
    expect(result.conditionalRules).toEqual([rule]);
    expect(result.conditionalRules[0]!.ranges[0]).not.toBe(rule.ranges[0]);
    result.conditionalRules[0]!.ranges[0] = { ...result.conditionalRules[0]!.ranges[0]!, startRow: 99 };
    expect(rule.ranges[0]!.startRow).toBe(20);
  });

  it("builds a host whose readRange speaks the vendored loader contract", async () => {
    const host = createXlsxModelHost(MODEL, { sessionId: "s-1", name: "book.xlsx", sha256: "b".repeat(64) });
    const result = await host.readRange({ sessionId: "s-1", sheetId: "sheet-2", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } });
    expect(result.cells).toHaveLength(1);
    expect(host.file.name).toBe("book.xlsx");
  });
});
