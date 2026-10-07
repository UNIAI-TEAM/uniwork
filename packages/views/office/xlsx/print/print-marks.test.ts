// UNI-952 D3: data bars and icon sets print the way the grid's canvas
// extensions draw them, from the CF view model's evaluated marks.
import { describe, expect, it } from "vitest";
import type { XlsxRenderStyle } from "@uniwork/office-engine/xlsx";
import { buildXlsxPrintCopy, type XlsxPrintCell, type XlsxPrintSheet } from "./print-copy";
import type { XlsxPrintMark } from "./print-marks";
import { resolvePrintSetup } from "./print-setup";

const PLAIN: XlsxRenderStyle = { bold: false, italic: false, underline: false, strikethrough: false, wrapText: false, diagonalUp: false, diagonalDown: false };
const ICON = "data:image/svg+xml;charset=utf-8,%3Csvg%20width%3D%2216%22%3E%3C%2Fsvg%3E";

function build(cells: Record<string, XlsxPrintCell>, marks: Record<string, XlsxPrintMark>, extra: Partial<XlsxPrintSheet> = {}): Document {
  const used = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 };
  const setup = resolvePrintSetup({ sheetIndex: 0, used });
  const result = buildXlsxPrintCopy({
    title: "Book",
    setup,
    areas: [used],
    cells: new Map(Object.entries(cells)),
    styles: [PLAIN],
    columns: new Map(),
    rows: new Map(),
    defaultColumnWidth: 48,
    defaultRowHeight: 15,
    merges: [],
    marks: new Map(Object.entries(marks)),
    ...extra,
  });
  if (!result.ok) throw new Error(result.reason);
  return new DOMParser().parseFromString(result.html, "text/html");
}

const number = (text: string): XlsxPrintCell => ({ text, kind: "number" });
const cellAt = (doc: Document, row: number, column: number): HTMLTableCellElement =>
  doc.querySelectorAll("tbody tr")[row]!.querySelectorAll("td")[column] as HTMLTableCellElement;

describe("data bars", () => {
  it("draws a positive bar right of its axis, as wide as the painter's percentage, under the text", () => {
    const doc = build({ "0:0": number("40") }, { "0:0": { dataBar: { color: "#638EC6", value: 50, startPoint: 0, isGradient: false } } });
    const cell = cellAt(doc, 0, 0);
    expect(cell.classList.contains("cf")).toBe(true);
    const bar = cell.querySelector(".db") as HTMLElement;
    // 48pt column - 2 x 1.5pt inset = 45pt; half of it from the 1.5pt inset.
    expect(bar.getAttribute("style")).toBe("left:1.5pt;width:22.5pt;background:#638EC6;border-radius:0 0.75pt 0.75pt 0");
    expect(cell.firstElementChild).toBe(bar);
    expect(cell.querySelector("span.cv")?.textContent).toBe("40");
    const html = doc.documentElement.outerHTML;
    expect(html).toContain("td.cf{position:relative}");
    expect(html).toContain(".db{position:absolute;top:1.5pt;bottom:1.5pt}");
  });

  it("draws a negative gradient bar left of a middle axis with the painter's outline", () => {
    const doc = build({ "0:0": number("-1") }, { "0:0": { dataBar: { color: "rgb(255, 0, 0)", value: -50, startPoint: 50, isGradient: true } } });
    const style = cellAt(doc, 0, 0).querySelector(".db")?.getAttribute("style");
    // Axis at 1.5 + 22.5 = 24pt; the bar is half of the 22.5pt left half.
    expect(style).toBe("left:12.75pt;width:11.25pt;background:linear-gradient(to left,rgb(255, 0, 0),#ffffff);border:0.75pt solid rgb(255, 0, 0);border-radius:0.75pt 0 0 0.75pt");
  });

  it("drops a bar whose colour is not a plain hex or rgb() value", () => {
    const doc = build({ "0:0": number("1") }, { "0:0": { dataBar: { color: "red;background:url(x)", value: 50, startPoint: 0, isGradient: false } } });
    expect(doc.querySelector(".db")).toBeNull();
    expect(cellAt(doc, 0, 0).classList.contains("cf")).toBe(false);
  });

  it("spans a merged cell and hides the value when the rule shows the bar only", () => {
    const doc = build(
      { "0:0": number("7") },
      { "0:0": { dataBar: { color: "#00ff00", value: 100, startPoint: 0, isGradient: false }, hideValue: true } },
      { merges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }] },
    );
    const cell = cellAt(doc, 0, 0);
    expect(cell.getAttribute("colspan")).toBe("2");
    expect(cell.querySelector(".db")?.getAttribute("style")).toContain("width:93pt");
    expect(cell.textContent).toBe("");
  });
});

describe("icon sets", () => {
  it("places the painter's icon at the cell's left, centred, and moves the text past it", () => {
    const doc = build({ "1:0": number("3") }, { "1:0": { icon: ICON } });
    const cell = cellAt(doc, 1, 0);
    const icon = cell.querySelector("img.ic") as HTMLImageElement;
    expect(icon.getAttribute("src")).toBe(ICON);
    expect(icon.getAttribute("style")).toBe("left:1.5pt;width:11.25pt;height:11.25pt;margin-top:-5.62pt");
    expect(cell.getAttribute("style")).toBe("padding-left:14.75pt");
    expect(cell.textContent).toBe("3");
  });

  it("prints no icon that is not a data: image or that does not fit the row", () => {
    const outside = build({ "0:0": number("1") }, { "0:0": { icon: "https://example.com/i.svg" } });
    expect(outside.querySelector("img")).toBeNull();
    const short = build({ "0:0": number("1") }, { "0:0": { icon: ICON } }, { rows: new Map([[0, { height: 9 }]]) });
    expect(short.querySelector("img")).toBeNull();
  });

  it("adds no mark rules when nothing is marked", () => {
    const doc = build({ "0:0": number("1") }, {});
    expect(doc.documentElement.outerHTML).not.toContain("td.cf");
  });
});
