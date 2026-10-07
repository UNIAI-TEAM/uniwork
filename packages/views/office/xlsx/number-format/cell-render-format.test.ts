import { describe, expect, it } from "vitest";
import type { XlsxRenderModel } from "@uniwork/office-engine/xlsx";
import { toRendererWorkbookFile } from "../xlsx-render-model-bridge";

// X5: a cell whose styles.xml carries `#,##0` must reach the vendored renderer
// with that pattern; the renderer turns style.numberFormat into the Univer
// cell style `n: { pattern }` (univer-sync.ts) and numfmt formats it.
const MODEL: XlsxRenderModel = {
  revision: 1,
  activeTab: 0,
  date1904: false,
  theme: { colors: Array.from({ length: 12 }, () => "#000000"), majorFont: "Calibri", minorFont: "Calibri" },
  normalFontName: "Calibri",
  styles: [
    { fontFamily: "Calibri", fontSize: 11, bold: false, italic: false, underline: false, strikethrough: false,
      wrapText: false, diagonalUp: false, diagonalDown: false, numberFormat: "General" },
    { fontFamily: "Calibri", fontSize: 11, bold: false, italic: false, underline: false, strikethrough: false,
      wrapText: false, diagonalUp: false, diagonalDown: false, numberFormat: "#,##0" },
  ],
  dxfStyles: [],
  sheets: [{ id: "s1", name: "Data", rowCount: 10, columnCount: 4, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [],
    cells: { B2: { v: 1250000000, s: 1 }, B3: { v: 1410000000 } } }],
};

describe("cell number format reaches the renderer", () => {
  it("keeps the #,##0 pattern on the style a cell points at, and General on an unstyled cell", () => {
    const file = toRendererWorkbookFile(MODEL, { sessionId: "s", name: "b.xlsx", sha256: "a".repeat(64) });
    expect(file.styles[1]?.numberFormat).toBe("#,##0");
    expect(file.styles[0]?.numberFormat).toBe("General");
  });
});
