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

const PLAIN = { bold: false, italic: false, underline: false, strikethrough: false, wrapText: false, diagonalUp: false, diagonalDown: false };
const SHEET = { hidden: false, showGridLines: true, showFormulas: false, showRowColHeaders: true, rightToLeft: false, tabColor: null, defaultRowHeight: null, defaultRowHeightFixed: false, freeze: null, columnWidths: [], pivotTables: [], tables: [], comments: [], pivotRanges: [] };

function host(definedNames: readonly unknown[] = []): XlsxGridHostPort {
  return {
    file: {
      sessionId: "s-1", name: "excel-visuals.xlsx", sha256: "a", entryCount: 1,
      // Region | Q1 | Q2 over four rows, as in the fixture.
      sheets: [{ ...SHEET, id: "sheet-1", name: "Data", rowCount: 4, columnCount: 3 }, { ...SHEET, id: "sheet-2", name: "Other", rowCount: 1, columnCount: 1 }],
      styles: [PLAIN], dxfStyles: [], visuals: [], definedNames, activeTab: 0, readOnly: false,
    },
    readRange: vi.fn(async () => ({ cells: [{ row: 0, column: 0, value: "Region", styleIndex: 0 }], rows: [], merges: [] })),
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
function source(port: XlsxGridHostPort): XlsxPrintableVisuals {
  return (sheetId, metricsFor) => printableVisuals(VISUALS, port.file.sheets, metricsFor ?? (() => null), (kind) => kind, sheetId);
}

async function printCopy(port: XlsxGridHostPort, sheetName: string, sheetId: string) {
  const collected = await collectXlsxPrintSheet({ host: port, sheetName, sheetId, snapshot: null, title: "Book", visuals: source(port) });
  if (!collected.ok) throw new Error(collected.reason);
  const copy = buildXlsxPrintCopy(collected.sheet);
  if (!copy.ok) throw new Error(copy.reason);
  return { sheet: collected.sheet, html: copy.html };
}

describe("print copy visuals (real listing, real ids)", () => {
  // The app stylesheet the overlay SVG resolves its token classes in.
  beforeEach(() => {
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
    const { sheet, html } = await printCopy(host([{ name: "_xlnm.Print_Area", formula: "Data!$A$1:$C$4", sheetIndex: 0 }]), "Data", "sheet-1");
    expect(sheet.areas).toEqual([{ startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 }]);
    expect(html).not.toContain('class="vis"');
  });
});
