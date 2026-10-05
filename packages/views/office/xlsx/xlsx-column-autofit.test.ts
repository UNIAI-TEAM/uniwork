import { describe, expect, it } from "vitest";
import type { XlsxRenderModel, XlsxRenderSheet } from "@uniwork/office-engine/xlsx";
import { seedFittedColumnWidths } from "./xlsx-column-autofit";
import { toRendererWorkbookFile } from "./xlsx-render-model-bridge";

const style = (numberFormat: string, extra: Record<string, unknown> = {}) => ({
  fontSize: 11, bold: false, italic: false, underline: false, strikethrough: false, wrapText: false,
  diagonalUp: false, diagonalDown: false, numberFormat, ...extra,
});
const sheetOf = (patch: Partial<XlsxRenderSheet>): XlsxRenderSheet => ({
  id: "s", name: "S", rowCount: 20, columnCount: 6, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [], cells: {}, ...patch,
});
const modelOf = (sheet: XlsxRenderSheet): XlsxRenderModel => ({
  revision: 1, activeTab: 0, date1904: false, sheets: [sheet], styles: [style("General"), style("#,##0"), style("General", { bold: true })], dxfStyles: [],
});

describe("seedFittedColumnWidths", () => {
  const model = modelOf(sheetOf({
    cells: { A1: { v: 1250000000 }, B1: { v: 1250000000, s: 1 }, C1: { v: "ok" }, D1: { v: "x".repeat(200) }, E1: { v: "tail" } },
  }));

  it("seeds a width that shows General numbers in full, without customWidth", () => {
    const seeded = seedFittedColumnWidths(model.sheets[0]!, model.styles);
    const a = seeded.find((span) => span.startColumn === 0)!;
    expect(a.width).toBeGreaterThanOrEqual(11);
    expect(a.customWidth).toBeFalsy();
  });

  it("measures the formatted text (thousands separators)", () => {
    const seeded = seedFittedColumnWidths(model.sheets[0]!, model.styles);
    const a = seeded.find((span) => span.startColumn === 0)!;
    const b = seeded.find((span) => span.startColumn === 1)!;
    expect(b.width!).toBeGreaterThan(a.width!);
  });

  it("leaves short content at the default width and clamps long text to 50", () => {
    const seeded = seedFittedColumnWidths(model.sheets[0]!, model.styles);
    expect(seeded.find((span) => span.startColumn === 2)).toBeUndefined();
    // D1 has a neighbour (E1), so it cannot overflow and is fitted, but clamped.
    expect(seeded.find((span) => span.startColumn === 3)!.width).toBe(50);
  });

  it("never touches a column the file sized or hid", () => {
    const sized = sheetOf({
      cells: { A1: { v: 1250000000 }, B1: { v: 1250000000 }, C1: { v: 1250000000 } },
      columnWidths: [{ startColumn: 0, endColumn: 0, width: 5, customWidth: true }, { startColumn: 1, endColumn: 1, hidden: true, width: 0 }],
    });
    const seeded = seedFittedColumnWidths(sized, modelOf(sized).styles);
    expect(seeded.filter((span) => span.startColumn <= 1)).toEqual(sized.columnWidths);
    expect(seeded.some((span) => span.startColumn === 2 && (span.width ?? 0) >= 11)).toBe(true);
  });

  it("keeps a width-less style-only span and seeds beside it", () => {
    const styled = sheetOf({ cells: { A1: { v: 1250000000 } }, columnWidths: [{ startColumn: 0, endColumn: 0, styleIndex: 1 }] });
    const seeded = seedFittedColumnWidths(styled, modelOf(styled).styles);
    expect(seeded).toContainEqual({ startColumn: 0, endColumn: 0, styleIndex: 1 });
    expect(seeded.some((span) => span.startColumn === 0 && (span.width ?? 0) >= 11)).toBe(true);
  });
});

describe("bridge column widths", () => {
  const meta = { sessionId: "s", name: "b.xlsx", sha256: "a".repeat(64) };

  it("passes stored widths and the sheetFormatPr defaults through in character units", () => {
    const sheet = sheetOf({ defaultColumnWidth: 12.5, baseColWidth: 10, columnWidths: [{ startColumn: 1, endColumn: 2, width: 18.7109375, customWidth: true }] });
    const out = toRendererWorkbookFile(modelOf(sheet), meta).sheets[0]!;
    expect(out.columnWidths).toEqual([{ startColumn: 1, endColumn: 2, width: 18.7109375, customWidth: true }]);
    expect(out.defaultColumnWidth).toBe(12.5);
    expect(out.baseColumnWidth).toBe(10);
  });

  it("seeds renderer widths but leaves the model (the save source) untouched", () => {
    const sheet = sheetOf({ cells: { A1: { v: 1250000000 } } });
    const model = modelOf(sheet);
    const before = JSON.stringify(model);
    const out = toRendererWorkbookFile(model, meta).sheets[0]!;
    expect(out.columnWidths[0]!.width).toBeGreaterThanOrEqual(11);
    expect(out.columnWidths.every((span) => !span.customWidth)).toBe(true);
    expect(JSON.stringify(model)).toBe(before);
    expect(model.sheets[0]!.columnWidths).toEqual([]);
  });
});

describe("table header filter room", () => {
  const table = { name: "T", area: { startRow: 0, startColumn: 0, endRow: 2, endColumn: 1 }, columnNames: ["Hạng mục", "B"], bandedRows: true, headerRow: true, totalsRow: false };
  const base = { cells: { A1: { v: "Hạng mục chi tiết" }, B1: { v: "B" }, A2: { v: "Hạng mục chi tiết" }, B2: { v: "x" } } };

  it("adds filter-button room to a table header cell only", () => {
    const plain = sheetOf(base);
    const withTable = sheetOf({ ...base, tables: [table] });
    const a = seedFittedColumnWidths(plain, modelOf(plain).styles).find((s) => s.startColumn === 0)?.width ?? 0;
    const b = seedFittedColumnWidths(withTable, modelOf(withTable).styles).find((s) => s.startColumn === 0)?.width ?? 0;
    expect(b).toBeCloseTo(a + 2, 1);
  });

  it("fits a header cell even when its right neighbour is empty", () => {
    const sheet = sheetOf({ cells: { A1: { v: "Hạng mục chi tiết" } }, tables: [{ ...table, area: { ...table.area, endColumn: 0 } }] });
    expect(seedFittedColumnWidths(sheet, modelOf(sheet).styles).some((s) => s.startColumn === 0 && (s.width ?? 0) > 17)).toBe(true);
  });
});
