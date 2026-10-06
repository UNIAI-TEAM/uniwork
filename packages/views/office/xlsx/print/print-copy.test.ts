import { describe, expect, it } from "vitest";
import type { XlsxPageSetupFields, XlsxRenderPageSetup, XlsxRenderStyle } from "@uniwork/office-engine/xlsx";
import { buildXlsxPrintCopy, MAX_PRINT_CELLS, type XlsxPrintCell, type XlsxPrintSheet } from "./print-copy";
import { resolvePrintSetup, type XlsxPrintDefinedName, type XlsxPrintRange } from "./print-setup";

const PLAIN: XlsxRenderStyle = { bold: false, italic: false, underline: false, strikethrough: false, wrapText: false, diagonalUp: false, diagonalDown: false };

interface SheetOptions {
  cells?: Record<string, XlsxPrintCell>;
  used?: XlsxPrintRange;
  file?: XlsxRenderPageSetup;
  session?: XlsxPageSetupFields;
  names?: XlsxPrintDefinedName[];
  merges?: XlsxPrintRange[];
  styles?: XlsxRenderStyle[];
  rows?: XlsxPrintSheet["rows"];
  columns?: XlsxPrintSheet["columns"];
  title?: string;
}

function sheet(options: SheetOptions = {}): XlsxPrintSheet {
  const used = options.used ?? { startRow: 0, endRow: 3, startColumn: 0, endColumn: 3 };
  const setup = resolvePrintSetup({ file: options.file, session: options.session, definedNames: options.names, sheetIndex: 0, used });
  return {
    title: options.title ?? "Book - Data",
    setup,
    range: setup.printArea ?? used,
    cells: new Map(Object.entries(options.cells ?? {})),
    styles: options.styles ?? [PLAIN],
    columns: options.columns ?? new Map(),
    rows: options.rows ?? new Map(),
    defaultColumnWidth: 48,
    defaultRowHeight: 15,
    merges: options.merges ?? [],
  };
}

function build(input: XlsxPrintSheet): { html: string; pages: number; doc: Document } {
  const result = buildXlsxPrintCopy(input);
  if (!result.ok) throw new Error(result.reason);
  return { html: result.html, pages: result.pages, doc: new DOMParser().parseFromString(result.html, "text/html") };
}

const text = (value: string): XlsxPrintCell => ({ text: value, kind: "text" });
const cellTexts = (doc: Document): string[] => Array.from(doc.querySelectorAll("tbody td")).map((cell) => cell.textContent ?? "");

describe("buildXlsxPrintCopy", () => {
  it("prints only the print area (sheet-scoped defined name)", () => {
    const { doc } = build(sheet({
      cells: { "0:0": text("out"), "1:1": text("in-1"), "2:2": text("in-2"), "3:3": text("out-2") },
      names: [{ name: "_xlnm.Print_Area", formula: "'Data'!$B$2:$C$3", sheetIndex: 0 }, { name: "_xlnm.Print_Area", formula: "Other!$A$1", sheetIndex: 1 }],
    }));
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(doc.querySelectorAll("colgroup col")).toHaveLength(2);
    expect(cellTexts(doc)).toEqual(["in-1", "", "", "in-2"]);
  });

  it("lets an unsaved dialog edit override the file's print area and orientation", () => {
    const { html, doc } = build(sheet({
      cells: { "0:0": text("a1"), "3:3": text("d4") },
      file: { orientation: "portrait" },
      session: { orientation: "landscape", printArea: "A1:A1" },
      names: [{ name: "_xlnm.Print_Area", formula: "Data!$A$1:$D$4", sheetIndex: 0 }],
    }));
    expect(cellTexts(doc)).toEqual(["a1"]);
    expect(html).toMatch(/@page\{size:11\.69in 8\.27in;margin:0\.75in 0\.7in 0\.75in 0\.7in\}/);
  });

  it("writes the file's paper, landscape orientation and margins into @page", () => {
    const { html } = build(sheet({ file: { orientation: "landscape", paperSize: 1, margins: { left: 0.25, right: 0.5, top: 1, bottom: 0.75 } } }));
    expect(html).toContain("@page{size:11in 8.5in;margin:1in 0.5in 0.75in 0.25in}");
  });

  it("shrinks to fit one page wide and ignores manual breaks when fitting", () => {
    // 40 columns of 48pt = 1920pt; A4 portrait printable width = 8.27-1.4 in = 494.6pt.
    const used = { startRow: 0, endRow: 1, startColumn: 0, endColumn: 39 };
    const fitted = build(sheet({ used, file: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, colBreaks: [10] } }));
    expect(fitted.pages).toBe(1);
    const width = Number(/<table style="width:([\d.]+)pt"/.exec(fitted.html)?.[1]);
    expect(width).toBeLessThanOrEqual(494.7);
    expect(width).toBeGreaterThan(480);
    const unfitted = build(sheet({ used }));
    expect(unfitted.pages).toBeGreaterThan(1);
  });

  it("applies a fixed scale to widths, heights and fonts", () => {
    const { html } = build(sheet({ file: { scale: 50 }, used: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } }));
    expect(html).toContain("<col style=\"width:24pt\">");
    expect(html).toContain("<tr style=\"height:7.5pt\">");
    expect(html).toContain("font-size:5.5pt");
  });

  it("splits long sheets into pages down, then over, and honours manual row breaks", () => {
    const used = { startRow: 0, endRow: 99, startColumn: 0, endColumn: 0 };
    const auto = build(sheet({ used }));
    // A4 portrait printable height = 11.69-1.5 in = 733.7pt -> 48 rows of 15pt.
    expect(auto.pages).toBe(3);
    expect(auto.html.match(/break-after:page/g)).toHaveLength(1);
    const manual = build(sheet({ used: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 }, file: { rowBreaks: [4] } }));
    expect(manual.pages).toBe(2);
    expect(manual.doc.querySelectorAll("section.page")[0]!.querySelectorAll("tbody tr")).toHaveLength(4);
  });

  it("repeats print-title rows in a <thead> on every following page", () => {
    const cells: Record<string, XlsxPrintCell> = { "0:0": text("Header") };
    for (let row = 1; row < 100; row += 1) cells[`${row}:0`] = text(`r${row + 1}`);
    const { doc } = build(sheet({ cells, used: { startRow: 0, endRow: 99, startColumn: 0, endColumn: 0 }, names: [{ name: "_xlnm.Print_Titles", formula: "Data!$1:$1", sheetIndex: 0 }] }));
    const pages = Array.from(doc.querySelectorAll("section.page"));
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0]!.querySelector("thead")).toBeNull();
    expect(pages[0]!.querySelector("tbody td")?.textContent).toBe("Header");
    for (const page of pages.slice(1)) expect(page.querySelector("thead td")?.textContent).toBe("Header");
  });

  it("renders merges as spans, carrying the anchor's text and style", () => {
    const bold: XlsxRenderStyle = { ...PLAIN, bold: true, fillColor: "FFFFFF00" };
    const { doc, html } = build(sheet({
      cells: { "0:0": { text: "Merged", kind: "text", styleIndex: 1 }, "0:1": text("hidden by merge") },
      styles: [PLAIN, bold],
      merges: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 }],
    }));
    const anchor = doc.querySelector("tbody td")!;
    expect(anchor.getAttribute("rowspan")).toBe("2");
    expect(anchor.getAttribute("colspan")).toBe("3");
    expect(anchor.textContent).toBe("Merged");
    expect(doc.querySelector("tbody tr")!.querySelectorAll("td")).toHaveLength(2);
    expect(html).not.toContain("hidden by merge");
    expect(html).toContain("td.s1{font-weight:700;background-color:#FFFF00}");
  });

  it("escapes cell text and the title, and stays script-free", () => {
    const { html, doc } = build(sheet({
      title: "</title><script>alert(1)</script>",
      cells: { "0:0": text("<img src=x onerror=alert(1)>"), "0:1": text("a & \"b\"") },
    }));
    expect(doc.querySelectorAll("script, img")).toHaveLength(0);
    expect(doc.querySelector("tbody td")!.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(html).toContain("a &amp; &quot;b&quot;");
    expect(doc.title).toBe("</title><script>alert(1)</script>");
    expect(doc.querySelector("meta[http-equiv]")?.getAttribute("content")).toContain("script-src 'none'");
  });

  it("rejects a style value that is not a colour or a font name", () => {
    const hostile: XlsxRenderStyle = { ...PLAIN, fontColor: "red;}body{display:none", fontFamily: "Arial\";}x{" };
    const { html } = build(sheet({ cells: { "0:0": { text: "x", kind: "text", styleIndex: 1 } }, styles: [PLAIN, hostile] }));
    expect(html).not.toContain("display:none");
    expect(html).toContain("td.s1{font-family:\"Arialx\", sans-serif}");
  });

  it("skips hidden rows and columns", () => {
    const { doc } = build(sheet({
      cells: { "0:0": text("a"), "0:1": text("hidden col"), "1:0": text("hidden row"), "2:0": text("c") },
      used: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 },
      rows: new Map([[1, { hidden: true }]]),
      columns: new Map([[1, { hidden: true }]]),
    }));
    expect(cellTexts(doc)).toEqual(["a", "c"]);
  });

  it("prints gridlines and row/column headings only when the setup asks", () => {
    const off = build(sheet());
    expect(off.html).not.toContain("td{border:");
    expect(off.doc.querySelectorAll("th")).toHaveLength(0);
    const on = build(sheet({ session: { printGridlines: true, printHeadings: true } }));
    expect(on.html).toContain("td{border:0.5pt solid #c0c0c0}");
    expect(Array.from(on.doc.querySelectorAll("thead th")).map((cell) => cell.textContent)).toEqual(["", "A", "B", "C", "D"]);
    expect(on.doc.querySelector("tbody th")?.textContent).toBe("1");
  });

  it("aligns General numbers right and lets text spill into empty neighbours", () => {
    const { doc } = build(sheet({ cells: { "0:0": text("A long title"), "1:0": { text: "1,250", kind: "number" }, "1:1": text("x") } }));
    const [title] = Array.from(doc.querySelectorAll("tbody td"));
    expect(title!.className).toBe("sp");
    expect(doc.querySelectorAll("tbody tr")[1]!.querySelector("td")!.className).toBe("n");
  });

  it("refuses a range too large to print", () => {
    const result = buildXlsxPrintCopy(sheet({ used: { startRow: 0, endRow: MAX_PRINT_CELLS, startColumn: 0, endColumn: 1 } }));
    expect(result).toEqual({ ok: false, reason: "print_too_large" });
  });
});
