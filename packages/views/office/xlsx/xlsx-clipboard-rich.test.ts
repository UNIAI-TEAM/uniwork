import { describe, expect, it, vi } from "vitest";
import { XLSX_CLIENT_MAX_EDIT_OPS } from "./xlsx-clipboard";
import { applyRichPaste, parseClipboardHtmlTable, planRichPaste, type XlsxRichPastePlan } from "./xlsx-clipboard-rich";

const EXCEL_HTML = `<html><head><style>
  .xl65 { mso-number-format:"0\\.00%"; font-weight:700 }
  .xl66 { background:#FFFF00; mso-pattern:auto none }
</style></head><body><table>
<tr><td class=xl65>0.5</td><td class=xl66>hi</td><td>plain</td></tr>
<tr><td style='font-weight:bold'>b</td><td><strong>s</strong></td><td bgcolor="#ff0000">r</td></tr>
</table></body></html>`;

describe("parseClipboardHtmlTable", () => {
  it("reads bold, fill and number format from Excel class and inline styles", () => {
    const table = parseClipboardHtmlTable(EXCEL_HTML);
    expect(table).not.toBeNull();
    expect(table![0]![0]).toEqual({ text: "0.5", bold: true, fill: null, numberFormat: "0.00%" });
    expect(table![0]![1]).toEqual({ text: "hi", bold: false, fill: "#ffff00", numberFormat: null });
    expect(table![0]![2]).toEqual({ text: "plain", bold: false, fill: null, numberFormat: null });
    expect(table![1]![0]!.bold).toBe(true);
    expect(table![1]![1]!.bold).toBe(true);
    expect(table![1]![2]!.fill).toBe("#ff0000");
  });

  it("reads Google Sheets number formats and skips white fills", () => {
    const html = `<table><tr><td style="background-color:#ffffff" data-sheets-numberformat="{&quot;1&quot;:2,&quot;2&quot;:&quot;#,##0.00&quot;}">1</td>`
      + `<td style="background-color:rgb(0, 128, 0);font-weight:600">2</td></tr></table>`;
    const table = parseClipboardHtmlTable(html)!;
    expect(table[0]![0]).toEqual({ text: "1", bold: false, fill: null, numberFormat: "#,##0.00" });
    expect(table[0]![1]).toEqual({ text: "2", bold: true, fill: "#008000", numberFormat: null });
  });

  it("expands colspan with empty cells and returns null without a table", () => {
    const table = parseClipboardHtmlTable("<table><tr><td colspan=2>a</td><td>b</td></tr></table>")!;
    expect(table[0]!.map((cell) => cell.text)).toEqual(["a", "", "b"]);
    expect(parseClipboardHtmlTable("<p>no table</p>")).toBeNull();
    expect(parseClipboardHtmlTable("")).toBeNull();
  });

  it("maps Excel number format keywords and drops unusable patterns", () => {
    const html = `<table><tr><td style='mso-number-format:Percent'>1</td><td style='mso-number-format:General'>2</td>`
      + `<td style='mso-number-format:"@"'>3</td></tr></table>`;
    const row = parseClipboardHtmlTable(html)![0]!;
    expect(row.map((cell) => cell.numberFormat)).toEqual(["0%", null, "@"]);
  });
});

describe("parseClipboardHtmlTable - Excel clipboard samples", () => {
  const formats = (html: string): (string | null)[] => parseClipboardHtmlTable(`<table><tr>${html}</tr></table>`)![0]!.map((cell) => cell.numberFormat);

  it("decodes CSS hex and backslash escapes in quoted formats", () => {
    expect(formats(`<td style='mso-number-format:"\\0022$\\0022\\#\\,\\#\\#0\\.00"'>1</td>`)).toEqual(['"$"#,##0.00']);
    expect(formats(`<td style='mso-number-format:"0\\.0\\0025"'>1</td>`)).toEqual(["0.0%"]);
    expect(formats(`<td style='mso-number-format:"\\#\\,\\#\\#0\\;\\[Red\\]\\#\\,\\#\\#0"'>1</td>`)).toEqual(["#,##0;[Red]#,##0"]);
  });

  it("treats an unquoted \\@ as the text format", () => {
    expect(formats(`<td style='mso-number-format:\\@'>1</td><td style='mso-number-format:"\\@"'>2</td>`)).toEqual(["@", "@"]);
  });

  it("maps Excel's named formats to real format codes", () => {
    const names = ["Short Date", "Long Date", "Medium Date", "Short Time", "Long Time", "Medium Time", "Percent", "Fixed", "Standard", "Currency", "Scientific", "Yes/No", "General"];
    const html = names.map((name) => `<td style='mso-number-format:"${name}"'>1</td>`).join("");
    expect(formats(html)).toEqual([
      "m/d/yyyy", "dddd, mmmm d, yyyy", "d-mmm-yy", "h:mm", "h:mm:ss AM/PM", "h:mm AM/PM",
      "0%", "0.00", "#,##0.00", '"$"#,##0.00', "0.00E+00", '"Yes";"Yes";"No"', null,
    ]);
  });

  it("drops unknown named formats instead of applying them as a pattern", () => {
    expect(formats(`<td style='mso-number-format:"Some Odd Name"'>1</td><td style='mso-number-format:Euro'>2</td>`)).toEqual([null, null]);
    expect(formats(`<td style='mso-number-format:"mmmm yyyy"'>1</td><td style='mso-number-format:"d mmm yyyy"'>2</td>`)).toEqual(["mmmm yyyy", "d mmm yyyy"]);
  });

  it("reads named CSS fills and ignores white, transparent and none", () => {
    const html = `<td style='background:yellow;mso-pattern:black none'>a</td><td bgcolor="Red">b</td>`
      + `<td style='background:white'>c</td><td style='background:transparent'>d</td><td style='background:none'>e</td>`
      + `<td style='background-color:LIGHTGRAY'>f</td>`;
    expect(parseClipboardHtmlTable(`<table><tr>${html}</tr></table>`)![0]!.map((cell) => cell.fill))
      .toEqual(["#ffff00", "#ff0000", null, null, null, "#d3d3d3"]);
  });

  it("refuses a table whose expanded grid would exceed the op limit before allocating it", () => {
    expect(parseClipboardHtmlTable("<table><tr><td colspan=16384>a</td></tr></table>")).toBeNull();
    const rows = "<tr><td colspan=5000>a</td></tr>".repeat(3);
    expect(parseClipboardHtmlTable(`<table>${rows}</table>`)).toBeNull();
    expect(parseClipboardHtmlTable("<table><tr><td colspan=500>a</td></tr></table>")![0]).toHaveLength(500);
  });
});

describe("planRichPaste", () => {
  const table = parseClipboardHtmlTable(EXCEL_HTML)!;
  const shape = [["0.5", "hi", "plain"], ["b", "s", "r"]];

  it("anchors the style payload and number formats at the selection start", () => {
    const plan = planRichPaste({ row: 2, column: 1 }, table, shape);
    expect(plan).not.toBe("over-limit");
    expect(plan).not.toBeNull();
    if (plan === null || plan === "over-limit") return;
    expect(plan.style).toEqual({
      2: { 1: { s: { bl: 1 } }, 2: { s: { bg: { rgb: "#ffff00" } } } },
      3: { 1: { s: { bl: 1 } }, 2: { s: { bl: 1 } }, 3: { s: { bg: { rgb: "#ff0000" } } } },
    });
    expect(plan.numberFormats.get("0.00%")).toEqual([{ row: 2, column: 1 }]);
    expect(plan.styledCells).toBe(5);
  });

  it("is null when nothing is formatted or the shapes disagree", () => {
    const plain = parseClipboardHtmlTable("<table><tr><td>a</td><td>b</td></tr></table>")!;
    expect(planRichPaste({ row: 0, column: 0 }, plain, [["a", "b"]])).toBeNull();
    expect(planRichPaste({ row: 0, column: 0 }, table, [["only"]])).toBeNull();
  });

  it("degrades to values when values plus formatted cells exceed the op limit", () => {
    const wide = Array.from({ length: XLSX_CLIENT_MAX_EDIT_OPS / 2 + 1 }, () => ({ text: "x", bold: true, fill: null, numberFormat: null }));
    const rich = planRichPaste({ row: 0, column: 0 }, [wide], [wide.map(() => "x")]);
    expect(rich).toBe("over-limit");
    const fits = wide.slice(0, 100);
    expect(planRichPaste({ row: 0, column: 0 }, [fits], [fits.map(() => "x")])).not.toBe("over-limit");
  });
});

describe("applyRichPaste", () => {
  const plan: XlsxRichPastePlan = {
    style: { 0: { 0: { s: { bl: 1 } } } },
    numberFormats: new Map([["0.00%", [{ row: 0, column: 1 }]]]),
    styledCells: 2,
  };

  it("writes the style payload once and one numfmt command per format code", async () => {
    const execute = vi.fn(async () => true);
    expect(await applyRichPaste({ execute }, "file-sha", "s1", plan)).toBe(true);
    expect(execute).toHaveBeenNthCalledWith(1, "sheet.command.set-range-values", { unitId: "file-sha", subUnitId: "s1", value: plan.style });
    expect(execute).toHaveBeenNthCalledWith(2, "sheet.command.numfmt.set.numfmt", { values: [{ row: 0, col: 1, pattern: "0.00%" }] });
  });

  it("reports false when the renderer refuses a command but still runs the rest", async () => {
    const execute = vi.fn(async (id: string) => id !== "sheet.command.set-range-values");
    expect(await applyRichPaste({ execute }, "file-sha", "s1", plan)).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
