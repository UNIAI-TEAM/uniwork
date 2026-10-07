import { describe, expect, it } from "vitest";
import { XLSX_CLIENT_MAX_EDIT_OPS } from "./xlsx-clipboard";
import { parseClipboardHtmlTable, planRichPaste } from "./xlsx-clipboard-rich";

const EXCEL_HTML = `<html><head><style>
  .xl65 { mso-number-format:"0\\.00%"; font-weight:700 }
  .xl66 { background:#FFFF00; mso-pattern:auto none }
</style></head><body><table>
<tr><td class=xl65>0.5</td><td class=xl66>hi</td><td>plain</td></tr>
<tr><td style='font-weight:bold'>b</td><td><strong>s</strong></td><td bgcolor="#ff0000">r</td></tr>
</table></body></html>`;

const firstRow = (html: string) => parseClipboardHtmlTable(`<table><tr>${html}</tr></table>`)!.rows[0]!;

describe("parseClipboardHtmlTable", () => {
  it("reads bold, fill and number format from Excel class and inline styles", () => {
    const table = parseClipboardHtmlTable(EXCEL_HTML)!;
    expect(table.rows[0]![0]).toEqual({ text: "0.5", style: { bl: 1, n: { pattern: "0.00%" } } });
    expect(table.rows[0]![1]).toEqual({ text: "hi", style: { bg: { rgb: "#ffff00" } } });
    expect(table.rows[0]![2]).toEqual({ text: "plain", style: {} });
    expect(table.rows[1]![0]!.style.bl).toBe(1);
    expect(table.rows[1]![1]!.style.bl).toBe(1);
    expect(table.rows[1]![2]!.style.bg).toEqual({ rgb: "#ff0000" });
    expect(table.merges).toEqual([]);
  });

  it("reads Google Sheets number formats and values and skips white fills", () => {
    const html = `<table><tr><td style="background-color:#ffffff" data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:1234.5}" data-sheets-numberformat="{&quot;1&quot;:2,&quot;2&quot;:&quot;#,##0.00&quot;}">1,234.50</td>`
      + `<td style="background-color:rgb(0, 128, 0);font-weight:600">2</td></tr></table>`;
    const row = parseClipboardHtmlTable(html)!.rows[0]!;
    expect(row[0]).toEqual({ text: "1,234.50", style: { n: { pattern: "#,##0.00" } }, number: 1234.5 });
    expect(row[1]).toEqual({ text: "2", style: { bl: 1, bg: { rgb: "#008000" } } });
  });

  it("returns null without a table", () => {
    expect(parseClipboardHtmlTable("<p>no table</p>")).toBeNull();
    expect(parseClipboardHtmlTable("")).toBeNull();
  });

  it("reads the Excel x:num source number", () => {
    expect(firstRow(`<td x:num="0.5" style='mso-number-format:"0\\.00%"'>50.00%</td><td x:num>7</td>`).map((cell) => cell.number))
      .toEqual([0.5, undefined]);
  });
});

describe("parseClipboardHtmlTable - source numbers need a surviving format (F-P1)", () => {
  it("keeps the display text for a number whose format was dropped", () => {
    const row = firstRow(`<td x:num="46301" style='mso-number-format:Euro'>25/09/2026</td><td x:num="1234.5">1234.5</td>`
      + `<td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:0.25}">25%</td>`
      + `<td x:num="0.5" style='mso-number-format:"0\\.00%"'>50.00%</td>`);
    expect(row.map((cell) => cell.number)).toEqual([undefined, undefined, undefined, 0.5]);
  });
});

describe("parseClipboardHtmlTable - bounds on a hostile payload (F-P4)", () => {
  it("refuses an HTML payload over 2 MB", () => {
    const table = `<table><tr><td style='font-weight:bold'>a</td></tr></table>`;
    expect(parseClipboardHtmlTable(table)).not.toBeNull();
    expect(parseClipboardHtmlTable(`${table}<!--${"x".repeat(2_000_001)}-->`)).toBeNull();
  });

  it("caps one cell's style string and keeps the end, where the inline style wins", () => {
    const filler = "x-y:z;".repeat(1000);
    expect(firstRow(`<td style='font-style:italic;${filler}'>a</td>`)[0]!.style).toEqual({});
    expect(firstRow(`<td style='${filler}font-style:italic'>a</td>`)[0]!.style).toEqual({ it: 1 });
  });

  it("folds a class rule repeated thousands of times into one", () => {
    const rules = `.a{font-style:italic}${".a{color:red}".repeat(1000)}`;
    const html = `<style>${rules}</style><table><tr><td class=a>x</td></tr></table>`;
    expect(parseClipboardHtmlTable(html)!.rows[0]![0]!.style).toEqual({ it: 1, cl: { rgb: "#ff0000" } });
  });

  it("reads at most 16 classes of one cell", () => {
    const names = Array.from({ length: 20 }, (_, index) => `c${index}`);
    const rules = names.map((name, index) => `.${name}{${index === 19 ? "font-style:italic" : "color:red"}}`).join("");
    const html = `<style>${rules}</style><table><tr><td class="${names.join(" ")}">x</td></tr></table>`;
    expect(parseClipboardHtmlTable(html)!.rows[0]![0]!.style).toEqual({ cl: { rgb: "#ff0000" } });
  });
});

describe("parseClipboardHtmlTable - fonts and borders", () => {
  it("reads font family, size, italic, underline, strike and colour", () => {
    const [cell] = firstRow(`<td style='font-family:"Times New Roman", serif;font-size:14.0pt;font-style:italic;text-decoration:underline line-through;color:#C00000'>x</td>`);
    expect(cell!.style).toEqual({ it: 1, ul: { s: 1 }, st: { s: 1 }, ff: "Times New Roman", fs: 14, cl: { rgb: "#c00000" } });
  });

  it("reads wrapper tags, px sizes and Excel's underline style, and drops default black and generic families", () => {
    const row = firstRow(`<td><i>a</i></td><td><u>b</u></td><td style='font-size:16px;font-family:sans-serif;color:windowtext'>c</td>`
      + `<td style='text-underline-style:single'>d</td>`);
    expect(row.map((cell) => cell.style)).toEqual([{ it: 1 }, { ul: { s: 1 } }, { fs: 12 }, { ul: { s: 1 } }]);
  });

  it("maps CSS borders to the renderer's border styles", () => {
    const [excel, sides, google] = firstRow(`<td style='border:.5pt solid windowtext'>a</td>`
      + `<td style='border-top:1.0pt solid red;border-bottom:1.5pt double #0000FF;border-left:.5pt dashed black;border-right:none'>b</td>`
      + `<td style='border-bottom:3px solid #000000;border-top:1px dotted rgb(0, 128, 0)'>c</td>`);
    const black = { rgb: "#000000" };
    expect(excel!.style.bd).toEqual({ t: { s: 1, cl: black }, b: { s: 1, cl: black }, l: { s: 1, cl: black }, r: { s: 1, cl: black } });
    expect(sides!.style.bd).toEqual({ t: { s: 8, cl: { rgb: "#ff0000" } }, b: { s: 7, cl: { rgb: "#0000ff" } }, l: { s: 4, cl: black } });
    expect(google!.style.bd).toEqual({ b: { s: 13, cl: black }, t: { s: 3, cl: { rgb: "#008000" } } });
  });

  it("maps a web 2px solid border to medium and 3px or thick to thick (F-P6)", () => {
    const [two, three, keyword, excelThick] = firstRow(`<td style='border:2px solid #000000'>a</td><td style='border:3px solid #000000'>b</td>`
      + `<td style='border:thick solid #000000'>c</td><td style='border:2.0pt solid windowtext'>d</td>`);
    expect(two!.style.bd!.t!.s).toBe(8);
    expect(three!.style.bd!.t!.s).toBe(13);
    expect(keyword!.style.bd!.t!.s).toBe(13);
    expect(excelThick!.style.bd!.t!.s).toBe(13);
  });

  it("lets the inline style win over the class rule", () => {
    const html = `<style>.a { font-weight:700; color:red }</style><table><tr><td class=a style='font-weight:400'>x</td></tr></table>`;
    expect(parseClipboardHtmlTable(html)!.rows[0]![0]!.style).toEqual({ cl: { rgb: "#ff0000" } });
  });
});

describe("parseClipboardHtmlTable - merges", () => {
  it("expands colspan and rowspan into covered cells and records the merged areas", () => {
    const html = `<table><tr><td colspan=2 rowspan=2 style='border:.5pt solid black'>a</td><td>b</td></tr>`
      + `<tr><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></table>`;
    const table = parseClipboardHtmlTable(html)!;
    expect(table.rows.map((row) => row.map((cell) => cell.text))).toEqual([["a", "", "b"], ["", "", "c"], ["d", "e", "f"]]);
    expect(table.merges).toEqual([{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }]);
    const edge = { s: 1, cl: { rgb: "#000000" } };
    expect(table.rows[0]![1]!.style).toEqual({ bd: { t: edge, r: edge } });
    expect(table.rows[1]![0]!.style).toEqual({ bd: { b: edge, l: edge } });
  });

  it("clamps a rowspan to the table and refuses a grid over the op limit before allocating it", () => {
    expect(parseClipboardHtmlTable("<table><tr><td rowspan=9>a</td><td>b</td></tr></table>")!.merges).toEqual([]);
    expect(parseClipboardHtmlTable("<table><tr><td colspan=16384>a</td></tr></table>")).toBeNull();
    expect(parseClipboardHtmlTable(`<table>${"<tr><td colspan=5000>a</td></tr>".repeat(3)}</table>`)).toBeNull();
    const rows = `<tr><td rowspan=3 colspan=4000>a</td></tr>${"<tr></tr>".repeat(2)}`;
    expect(parseClipboardHtmlTable(`<table>${rows}</table>`)).toBeNull();
    expect(parseClipboardHtmlTable("<table><tr><td colspan=500>a</td></tr></table>")!.rows[0]).toHaveLength(500);
  });
});

describe("parseClipboardHtmlTable - Excel clipboard samples", () => {
  const formats = (html: string) => firstRow(html).map((cell) => cell.style.n?.pattern ?? null);

  it("decodes CSS hex and backslash escapes in quoted formats", () => {
    expect(formats(`<td style='mso-number-format:"\\0022$\\0022\\#\\,\\#\\#0\\.00"'>1</td>`)).toEqual(['"$"#,##0.00']);
    expect(formats(`<td style='mso-number-format:"0\\.0\\0025"'>1</td>`)).toEqual(["0.0%"]);
    expect(formats(`<td style='mso-number-format:"\\#\\,\\#\\#0\\;\\[Red\\]\\#\\,\\#\\#0"'>1</td>`)).toEqual(["#,##0;[Red]#,##0"]);
  });

  it("treats an unquoted \\@ as the text format and maps keywords", () => {
    expect(formats(`<td style='mso-number-format:\\@'>1</td><td style='mso-number-format:"\\@"'>2</td>`)).toEqual(["@", "@"]);
    expect(formats(`<td style='mso-number-format:Percent'>1</td><td style='mso-number-format:General'>2</td>`)).toEqual(["0%", null]);
  });

  it("maps Excel's named formats to real format codes", () => {
    const names = ["Short Date", "Long Date", "Medium Date", "Short Time", "Long Time", "Medium Time", "Percent", "Fixed", "Standard", "Currency", "Scientific", "Yes/No", "General"];
    expect(formats(names.map((name) => `<td style='mso-number-format:"${name}"'>1</td>`).join(""))).toEqual([
      "m/d/yyyy", "dddd, mmmm d, yyyy", "d-mmm-yy", "h:mm", "h:mm:ss AM/PM", "h:mm AM/PM",
      "0%", "0.00", "#,##0.00", '"$"#,##0.00', "0.00E+00", '"Yes";"Yes";"No"', null,
    ]);
  });

  it("drops unknown named formats instead of applying them as a pattern", () => {
    expect(formats(`<td style='mso-number-format:"Some Odd Name"'>1</td><td style='mso-number-format:Euro'>2</td>`)).toEqual([null, null]);
    expect(formats(`<td style='mso-number-format:"mmmm yyyy"'>1</td><td style='mso-number-format:"d mmm yyyy"'>2</td>`)).toEqual(["mmmm yyyy", "d mmm yyyy"]);
  });

  it("reads named CSS fills and ignores white, transparent and none (MINOR-1)", () => {
    const html = `<td style='background:yellow;mso-pattern:black none'>a</td><td bgcolor="Red">b</td>`
      + `<td style='background:white'>c</td><td style='background:transparent'>d</td><td style='background:none'>e</td>`
      + `<td style='background-color:LIGHTGRAY'>f</td>`;
    expect(firstRow(html).map((cell) => cell.style.bg?.rgb ?? null)).toEqual(["#ffff00", "#ff0000", null, null, null, "#d3d3d3"]);
  });
});

describe("planRichPaste", () => {
  const table = parseClipboardHtmlTable(EXCEL_HTML)!;
  const shape = [["0.5", "hi", "plain"], ["b", "s", "r"]];

  it("keeps per-cell styles in the plain-text grid and anchors merges at the selection", () => {
    const plan = planRichPaste({ row: 2, column: 1 }, table, shape);
    if (plan === null || plan === "over-limit") throw new Error("expected a plan");
    expect(plan.styles).toEqual([
      [{ bl: 1, n: { pattern: "0.00%" } }, { bg: { rgb: "#ffff00" } }, null],
      [{ bl: 1 }, { bl: 1 }, { bg: { rgb: "#ff0000" } }],
    ]);
    expect(plan.numbers).toEqual([[null, null, null], [null, null, null]]);
    const merged = parseClipboardHtmlTable("<table><tr><td colspan=2>a</td></tr></table>")!;
    const mergePlan = planRichPaste({ row: 4, column: 3 }, merged, [["a", ""]]);
    if (mergePlan === null || mergePlan === "over-limit") throw new Error("expected a plan");
    expect(mergePlan.merges).toEqual([{ startRow: 4, endRow: 4, startColumn: 3, endColumn: 4 }]);
  });

  it("is null when nothing is formatted or the shapes disagree", () => {
    const plain = parseClipboardHtmlTable("<table><tr><td>a</td><td>b</td></tr></table>")!;
    expect(planRichPaste({ row: 0, column: 0 }, plain, [["a", "b"]])).toBeNull();
    expect(planRichPaste({ row: 0, column: 0 }, table, [["only"]])).toBeNull();
  });

  it("is null for a same-shaped table whose text differs from the plain text (MINOR-2)", () => {
    expect(planRichPaste({ row: 0, column: 0 }, table, [["0.5", "hi", "plain"], ["b", "s", "other"]])).toBeNull();
    // Whitespace differences alone do not reject the payload.
    expect(planRichPaste({ row: 0, column: 0 }, table, [["0.5", " hi ", "plain"], ["b", "s", "r"]])).not.toBeNull();
  });

  it("degrades to values when values plus merges exceed the op limit", () => {
    const cells = XLSX_CLIENT_MAX_EDIT_OPS / 2 + 1;
    const rich = { rows: [Array.from({ length: cells }, () => ({ text: "x", style: { bl: 1 as const } }))], merges: Array.from({ length: cells }, () => ({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 })) };
    expect(planRichPaste({ row: 0, column: 0 }, rich, [rich.rows[0]!.map(() => "x")])).toBe("over-limit");
    // Styles ride the value's edit: a fully styled paste at the limit still fits.
    const styled = { rows: rich.rows, merges: [] };
    expect(planRichPaste({ row: 0, column: 0 }, styled, [rich.rows[0]!.map(() => "x")])).not.toBe("over-limit");
  });
});
