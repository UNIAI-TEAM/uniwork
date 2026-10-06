// UNI-952 D2: the XLSX print gaps - multi-area print areas, repeated title
// columns, header/footer, overflow and ####, rotation (pictures: print-visuals.test).
import { describe, expect, it } from "vitest";
import type { XlsxRenderPageSetup, XlsxRenderStyle } from "@uniwork/office-engine/xlsx";
import { buildXlsxPrintCopy, type XlsxPrintCell, type XlsxPrintSheet } from "./print-copy";
import { parseHeaderFooter } from "./print-header-footer";
import { resolvePrintSetup, type XlsxPrintDefinedName, type XlsxPrintRange } from "./print-setup";

const PLAIN: XlsxRenderStyle = { bold: false, italic: false, underline: false, strikethrough: false, wrapText: false, diagonalUp: false, diagonalDown: false };
const CONTEXT = { sheetName: "Data", fileName: "Book.xlsx", date: "06/10/2026", time: "19:30" };

interface Options {
  cells?: Record<string, XlsxPrintCell>;
  used?: XlsxPrintRange;
  file?: XlsxRenderPageSetup;
  names?: XlsxPrintDefinedName[];
  styles?: XlsxRenderStyle[];
}

function sheet(options: Options = {}): XlsxPrintSheet {
  const used = options.used ?? { startRow: 0, endRow: 3, startColumn: 0, endColumn: 3 };
  const setup = resolvePrintSetup({ file: options.file, definedNames: options.names, sheetIndex: 0, used });
  return {
    title: "Book - Data",
    setup,
    areas: setup.printAreas ?? [used],
    cells: new Map(Object.entries(options.cells ?? {})),
    styles: options.styles ?? [PLAIN],
    columns: new Map(),
    rows: new Map(),
    defaultColumnWidth: 48,
    defaultRowHeight: 15,
    merges: [],
    headerContext: CONTEXT,
  };
}

function build(input: XlsxPrintSheet): { html: string; pages: number; doc: Document } {
  const result = buildXlsxPrintCopy(input);
  if (!result.ok) throw new Error(result.reason);
  return { html: result.html, pages: result.pages, doc: new DOMParser().parseFromString(result.html, "text/html") };
}

const text = (value: string, styleIndex?: number): XlsxPrintCell => ({ text: value, kind: "text", ...(styleIndex === undefined ? {} : { styleIndex }) });
const number = (value: string, styleIndex?: number): XlsxPrintCell => ({ text: value, kind: "number", ...(styleIndex === undefined ? {} : { styleIndex }) });
const pageTexts = (doc: Document): string[][] =>
  Array.from(doc.querySelectorAll("section.page")).map((page) => Array.from(page.querySelectorAll("td")).map((cell) => cell.textContent ?? ""));

describe("multi-area print areas", () => {
  it("prints each area on pages of its own, in the order the name lists them", () => {
    const { doc, pages } = build(sheet({
      cells: { "0:0": text("a1"), "2:3": text("d3"), "3:3": text("d4") },
      names: [{ name: "_xlnm.Print_Area", formula: "Data!$D$3:$D$4,Data!$A$1", sheetIndex: 0 }],
    }));
    expect(pages).toBe(2);
    expect(pageTexts(doc)).toEqual([["d3", "d4"], ["a1"]]);
  });
});

describe("print titles", () => {
  it("repeats title columns at the left of every later page, beside title rows", () => {
    const cells: Record<string, XlsxPrintCell> = { "0:0": text("Key") };
    for (let column = 1; column < 30; column += 1) cells[`0:${column}`] = text(`h${column}`);
    const { doc } = build(sheet({
      cells,
      used: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 29 },
      names: [{ name: "_xlnm.Print_Titles", formula: "Data!$A:$A,Data!$1:$1", sheetIndex: 0 }],
    }));
    const pages = Array.from(doc.querySelectorAll("section.page"));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]!.querySelector("td")?.textContent).toBe("Key");
    for (const page of pages.slice(1)) {
      // Each later page starts with column A, and the title row stays row 1.
      expect(page.querySelector("tbody td")?.textContent).toBe("Key");
      expect(page.querySelectorAll("colgroup col").length).toBeGreaterThan(1);
    }
  });
});

describe("header and footer", () => {
  it("splits Excel's sections and resolves its field codes", () => {
    expect(parseHeaderFooter("&L&A&C&\"Arial,Bold\"&14Page &P of &N&R&D && &F&KFF0000x&Z&G", CONTEXT)).toEqual({
      left: { parts: [{ text: "Data" }], font: { bold: false, italic: false, underline: "none", strike: false } },
      center: {
        parts: [{ text: "Page " }, { counter: "page" }, { text: " of " }, { counter: "pages" }],
        font: { bold: true, italic: false, underline: "none", strike: false, family: "Arial", size: 14 },
      },
      // &Z prints nothing here: the string already prints the file name; &G is a picture part.
      right: { parts: [{ text: "06/10/2026 & Book.xlsxx" }, { picture: true }], font: { bold: false, italic: false, underline: "none", strike: false } },
    });
  });

  it("reads font codes per section: toggles, size, colour, name and style", () => {
    const parsed = parseHeaderFooter("&L&B&I&U&S&8&K00FF00left&B bold off&C&\"Times New Roman,Italic\"&E centre&R&KTT+000plain", CONTEXT);
    expect(parsed.left.font).toEqual({ bold: true, italic: true, underline: "single", strike: true, size: 8, color: "00FF00" });
    // The font in effect at the first printed part wins; the later &B is ignored.
    expect(parsed.left.parts).toEqual([{ text: "left bold off" }]);
    expect(parsed.center.font).toEqual({ bold: false, italic: true, underline: "double", strike: false, family: "Times New Roman" });
    // A theme colour keeps the default; each section starts plain.
    expect(parsed.right).toEqual({ parts: [{ text: "plain" }], font: { bold: false, italic: false, underline: "none", strike: false } });
    expect(parseHeaderFooter("&C&\"-,Regular\"&12x", CONTEXT).center.font).toEqual({ bold: false, italic: false, underline: "none", strike: false, size: 12 });
  });

  it("prints &Z as the location the host gives, else the document name, never twice", () => {
    expect(parseHeaderFooter("&L&Z", CONTEXT).left.parts).toEqual([{ text: "Book.xlsx" }]);
    expect(parseHeaderFooter("&L&Z&F", CONTEXT).left.parts).toEqual([{ text: "Book.xlsx" }]);
    expect(parseHeaderFooter("&L&Z&&F", CONTEXT).left.parts).toEqual([{ text: "Book.xlsx&F" }]);
    expect(parseHeaderFooter("&L&Z/&F", { ...CONTEXT, location: "Team / Finance" }).left.parts).toEqual([{ text: "Team / Finance/Book.xlsx" }]);
  });

  it("styles each margin box with its section's font, at the print scale", () => {
    const { html } = build(sheet({
      file: { headerFooter: { oddHeader: "&L&\"Arial;}<,Bold Italic\"&20&KC00000Red&C&E&Splain" } },
    }));
    expect(html).toMatch(/@top-left\{content:"Red";[^}]*;font-family:"Arial", sans-serif;font-size:20pt;font-weight:700;font-style:italic;color:#C00000\}/);
    expect(html).toMatch(/@top-center\{content:"plain";[^}]*;text-decoration:underline line-through double\}/);
    expect(html).not.toContain("Arial;}<");
  });

  it("prints even pages from the even text when differentOddEven is set, first page last", () => {
    const { html } = build(sheet({
      file: { headerFooter: { oddFooter: "&Codd", evenFooter: "&Ceven &P", firstFooter: "&Cfirst", differentOddEven: true, differentFirst: true } },
    }));
    const odd = html.indexOf("@page{@top-left");
    const even = html.indexOf("@page:left{");
    const first = html.indexOf("@page:first{");
    expect(odd).toBeGreaterThan(-1);
    expect(even).toBeGreaterThan(odd);
    expect(first).toBeGreaterThan(even);
    expect(html).toContain("@bottom-center{content:\"even \" counter(page);");
    expect(html.slice(even, first)).toContain("content:\"even \" counter(page);");
    // Without the flag the even text is ignored.
    const plainHtml = build(sheet({ file: { headerFooter: { oddFooter: "&Codd", evenFooter: "&Ceven" } } })).html;
    expect(plainHtml).not.toContain("@page:left");
    expect(plainHtml).not.toContain("even");
  });

  it("prints odd and first-page text in the margin boxes with page counters", () => {
    const { html } = build(sheet({
      file: {
        margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.4 },
        headerFooter: { oddHeader: "&CBudget &A", oddFooter: "&RPage &P / &N", firstFooter: "&CCover", differentFirst: true },
      },
    }));
    expect(html).toContain("@top-center{content:\"Budget Data\";");
    expect(html).toContain("padding-top:0.3in");
    expect(html).toContain("@bottom-right{content:\"Page \" counter(page) \" / \" counter(pages);");
    expect(html).toContain("padding-bottom:0.4in");
    expect(html).toMatch(/@page:first\{@top-left\{content:none;.*@bottom-center\{content:"Cover";/);
  });

  it("keeps header text inside its CSS string and its <style> element", () => {
    const { doc, html } = build(sheet({ file: { headerFooter: { oddHeader: "&C\"};</style><script>x</script>\\" } } }));
    expect(html).not.toContain("</style><script>");
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(html).toContain("content:\"\\22 };\\3c /style\\3e \\3c script\\3e x\\3c /script\\3e \\5c \"");
  });

  it("keeps a header/footer distance at or past the margin inside the margin box (R10)", () => {
    const { html } = build(sheet({
      file: {
        margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.25, header: 0.9, footer: 0.2 },
        headerFooter: { oddHeader: "&CTop", oddFooter: "&C&20Big" },
      },
    }));
    // 0.75in margin - one 11pt line (13.2pt = 0.18in) = 0.57in.
    expect(html).toContain("padding-top:0.57in");
    // A 20pt line (0.33in) does not fit a 0.25in margin: no padding at all.
    expect(html).toContain("padding-bottom:0in");
  });

  it("adds nothing when the file has no header or footer", () => {
    expect(build(sheet()).html).not.toContain("@top-");
  });
});

describe("overflow and ####", () => {
  const right: XlsxRenderStyle = { ...PLAIN, horizontalAlignment: "right" };
  const center: XlsxRenderStyle = { ...PLAIN, horizontalAlignment: "center", verticalAlignment: "top" };

  it("spills right-aligned text to the left and centred text to both sides, only into empty cells", () => {
    const { doc } = build(sheet({
      styles: [PLAIN, right, center],
      cells: {
        "0:2": text("A rather long right text", 1),
        "1:1": text("Centred long heading", 2),
        "2:0": text("stop"), "2:1": text("A very long left text"), "2:3": text("x"),
      },
    }));
    const rows = Array.from(doc.querySelectorAll("tbody tr"));
    const spill = (row: number, column: number) => rows[row]!.querySelectorAll("td")[column]!.querySelector(".ox")?.getAttribute("style");
    expect(spill(0, 2)).toBe("left:-96pt;right:0pt;justify-content:flex-end;align-items:flex-end");
    expect(spill(1, 1)).toBe("left:-48pt;right:-48pt;justify-content:center;align-items:flex-start");
    // C3 is empty but D3 holds "x": the spill stops after one column.
    expect(spill(2, 1)).toBe("left:0pt;right:-48pt;justify-content:flex-start;align-items:flex-end");
  });

  it("clips text with no empty neighbour and leaves short text alone", () => {
    const { doc } = build(sheet({ cells: { "0:0": text("Too long to fit here"), "0:1": text("b"), "1:0": text("ok") } }));
    expect(doc.querySelectorAll(".ox")).toHaveLength(0);
  });

  it("spills toward the left on a right-to-left sheet (R2)", () => {
    const { doc } = build({ ...sheet({ cells: { "2:0": text("stop"), "2:1": text("A very long left text"), "2:3": text("x") } }), rightToLeft: true });
    const cell = Array.from(doc.querySelectorAll("tbody tr"))[2]!.querySelectorAll("td")[1]!;
    // The logical next column (C) is physically on the left under dir="rtl".
    expect(cell.querySelector(".ox")?.getAttribute("style")).toBe("left:-48pt;right:0pt;justify-content:flex-start;align-items:flex-end");
  });

  it("spills a repeated title column only into its sheet neighbour, not the page's first body column (R3)", () => {
    const { doc } = build(sheet({
      cells: { "0:0": text("A long title column text") },
      used: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 29 },
      names: [{ name: "_xlnm.Print_Titles", formula: "Data!$A:$A", sheetIndex: 0 }],
    }));
    const pages = Array.from(doc.querySelectorAll("section.page"));
    expect(pages.length).toBeGreaterThan(1);
    const first = (page: Element) => page.querySelector("tbody td")!;
    // Page 1: A spills into B. Later pages: A sits beside a far column.
    expect(first(pages[0]!).querySelector(".ox")).not.toBeNull();
    for (const page of pages.slice(1)) {
      expect(first(page).textContent).toBe("A long title column text");
      expect(first(page).querySelector(".ox")).toBeNull();
    }
  });

  it("spills across a hidden column to the next shown one", () => {
    const base = sheet({ cells: { "0:0": text("A very long left text") } });
    const { doc } = build({ ...base, columns: new Map([[1, { hidden: true }]]) });
    expect(doc.querySelector("tbody td .ox")?.getAttribute("style")).toContain("right:-96pt");
  });

  it("shows #### for a formatted number too wide and rounds a General decimal first", () => {
    const formatted: XlsxRenderStyle = { ...PLAIN, numberFormat: "#,##0.00" };
    const { doc } = build(sheet({
      styles: [PLAIN, formatted],
      cells: { "0:0": number("1,234,567,890.00", 1), "1:0": number("3.14159265358979"), "2:0": number("12") },
    }));
    const texts = pageTexts(doc)[0]!.filter((value) => value !== "");
    expect(texts[0]).toMatch(/^#{6,}$/);
    expect(texts[1]).toBe("3.141593");
    expect(texts[2]).toBe("12");
  });
});

describe("text rotation", () => {
  it("turns rotated text inside its cell, counterclockwise, clockwise or stacked", () => {
    const styles = [PLAIN, { ...PLAIN, textRotation: 45 }, { ...PLAIN, textRotation: 135 }, { ...PLAIN, textRotation: 255 }];
    const { doc, html } = build(sheet({ styles, cells: { "0:0": text("up", 1), "0:1": text("down", 2), "0:2": text("stack", 3) } }));
    expect(doc.querySelectorAll("td > span.rt")).toHaveLength(3);
    expect(html).toContain("td.s1>.rt{display:inline-block;white-space:nowrap;transform:rotate(-45deg)}");
    expect(html).toContain("td.s2>.rt{display:inline-block;white-space:nowrap;transform:rotate(45deg)}");
    expect(html).toContain("td.s3>.rt{display:inline-block;writing-mode:vertical-rl;text-orientation:upright}");
  });
});
