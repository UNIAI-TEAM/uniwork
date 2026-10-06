// G3-05c render-model reader tests over the REAL patched gateway artifact
// (scripts/office/build-upstream.mjs). The per-test esbuild of the unpatched
// upstream source is gone: bindXlsxGateway refuses a bundle without patch
// 0010's marker since da863e33. Locally a missing artifact skips with a
// warning; REQUIRE_XLSX_GATEWAY=1 (the cloud round) fails instead.
import { beforeAll, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsxRenderModel, renderModelCellCount, type XlsxGatewayFunctions, type XlsxRenderModel } from "../src/xlsx";
import { parseThemeXml } from "../src/xlsx/render-model";
import { parseDefinedNamesXml } from "../src/xlsx/render-model-xml";
import { parseStylesXml } from "../src/xlsx/render-model-styles";
import { parseConditionalRules } from "../src/xlsx/render-model-conditional";
import { describeWithPatchedGateway, loadPatchedGateway } from "./xlsx-patched-gateway";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");
// The run folder sits three levels above the worktree (worktrees/dev-uniwork/<lane>).
const D3_FIXTURES = join(REPO, "..", "..", "..", "office-g3g4", "reports", "g3-d3-xlsx", "fixtures");

let engine: XlsxGatewayFunctions;

const loadEngine = () => beforeAll(async () => { engine = await loadPatchedGateway(); });

const readFixture = async (name: string): Promise<{ model: XlsxRenderModel; snapshotSheets: { name: string; cells: Record<string, unknown> }[] }> => {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));
  const imported = await engine.readWorkbook(bytes);
  const model = await readXlsxRenderModel(engine, bytes);
  return { model, snapshotSheets: imported.snapshot.sheets as never };
};

describeWithPatchedGateway("xlsx render model reader", () => {
  loadEngine();
  it("reads classic visual-rule metadata and rejects malformed rule targets/priorities", () => {
    const rules = parseConditionalRules(`<worksheet>
      <conditionalFormatting sqref="bad"><cfRule type="expression" priority="1"><formula>A1&gt;0</formula></cfRule></conditionalFormatting>
      <conditionalFormatting sqref="A1"><cfRule type="expression" priority="0"/><cfRule priority="1"/>
        <cfRule type="colorScale" priority="1"><colorScale><cfvo type="min"/><cfvo type="num" val="5" gte="false"/><color theme="4"/><color rgb="FFFF0000"/></colorScale></cfRule>
        <cfRule type="iconSet" priority="2" percent="true" bottom="1" rank="5" stopIfTrue="false" text="A&amp;B" dxfId="invalid"><iconSet iconSet="3Arrows" reverse="true" showValue="false"><cfvo type="percent" val="50" gte="true"/></iconSet></cfRule>
        <cfRule type="dataBar" priority="3"><dataBar showValue="0"><cfvo type="max"/><color rgb="FF00FF00"/></dataBar></cfRule>
        <cfRule type="expression" priority="4"><formula>A1&gt;0</formula></cfRule>
      </conditionalFormatting></worksheet>`,
      ref => ref === "A1" ? { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } : null,
      ["#FFFFFF", "#000000", "#FFFFFF", "#000000", "#4472C4"]);
    expect(rules).toHaveLength(4);
    expect(rules[0]).toMatchObject({ ruleType: "colorScale", colors: ["#4472C4", "#FF0000"],
      cfvos: [{ kind: "min" }, { kind: "num", value: "5", gte: false }], showValue: true });
    expect(rules[1]).toMatchObject({ iconSetName: "3Arrows", iconReverse: true, showValue: false,
      percent: true, bottom: true, rank: 5, stopIfTrue: false, text: "A&B", cfvos: [{ kind: "percent", value: "50", gte: true }] });
    expect(rules[1]?.dxfIndex).toBeUndefined();
    expect(rules[2]).toMatchObject({ ruleType: "dataBar", showValue: false, colors: ["#00FF00"] });
    expect(rules[3]?.formulas).toEqual(["A1>0"]);
  });
  it("decodes inline differential number formats once and never inherits normal font/fill", () => {
    const parsed = parseStylesXml('<styleSheet><numFmts><numFmt numFmtId="164" formatCode="&amp;lt;"/></numFmts><fonts><font><name val="Verdana"/><b/></font></fonts><fills><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill></fills><cellXfs><xf numFmtId="164"/></cellXfs><dxfs><dxf><numFmt numFmtId="165" formatCode="&quot;A&amp;B&quot;0.00"/></dxf></dxfs></styleSheet>', undefined);
    expect(parsed.styles[0]?.numberFormat).toBe("&lt;");
    expect(parsed.dxfStyles[0]?.numberFormat).toBe('"A&B"0.00');
    expect(parsed.dxfStyles[0]?.fontFamily).toBeUndefined();
    expect(parsed.dxfStyles[0]?.fillColor).toBeUndefined();
    expect(parsed.dxfStyles[0]?.bold).toBe(false);
  });
  it("retains inline rich-string runs and sheet-wide conditional rules without requiring the optional corpus", async () => {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, "xlsx-kitchen-sink.xlsx")));
    const xmls: Record<string, string> = {
      "xl/workbook.xml": '<workbook><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="r1" Type="test/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      "xl/styles.xml": '<styleSheet><fonts><font><name val="Verdana"/></font></fonts><cellXfs><xf/></cellXfs><dxfs><dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs></styleSheet>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t> A &amp; </t></r><r><t>B </t></r></is></c></row></sheetData><conditionalFormatting sqref="A1:A2 C4"><cfRule type="cellIs" operator="lessThan" dxfId="0" priority="2" stopIfTrue="1"><formula>10</formula></cfRule></conditionalFormatting></worksheet>',
    };
    const model = await readXlsxRenderModel({ ...engine,
      readEntriesText: async (_bytes, paths) => Object.fromEntries(paths.map((path) => [path, xmls[path] ?? null])),
    }, bytes);
    expect(model.sheets[0]?.cells.A1?.v).toBe(" A & B ");
    expect(model.sheets[0]).toMatchObject({ conditionalRules: [{ ruleType: "cellIs", operator: "lessThan",
      ranges: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }, { startRow: 3, endRow: 3, startColumn: 2, endColumn: 2 }],
      formulas: ["10"], dxfIndex: 0, priority: 2, stopIfTrue: true,
    }] });
    expect(model.dxfStyles[0]).toMatchObject({ fontColor: "#9C0006", fillColor: "#FFC7CE" });
    expect(model.dxfStyles[0]?.fontFamily).toBeUndefined();
    expect(model.styles[0]?.fontFamily).toBe("Verdana");
  });
  it("reads a namespaced Office theme and resolves system colors from lastClr", () => {
    const theme = parseThemeXml(`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
      <a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="123456"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>
      <a:fontScheme name="Office"><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="Yu Gothic"/></a:minorFont></a:fontScheme>
    </a:themeElements></a:theme>`);
    expect(theme).toMatchObject({ colors: ["#FFFFFF", "#123456", "#000000", "#000000", "#4472C4", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000", "#000000"], majorFont: "Cambria", minorFont: "Calibri", minorEa: "Yu Gothic" });
  });
  it("keeps every basic-read cell and materialises the cached formula results", async () => {
    const { model, snapshotSheets } = await readFixture("xlsx-kitchen-sink.xlsx");
    expect(model.sheets.map((sheet) => sheet.name)).toEqual(snapshotSheets.map((sheet) => sheet.name));
    let formulaCells = 0;
    for (const snapshotSheet of snapshotSheets) {
      const renderSheet = model.sheets.find((sheet) => sheet.name === snapshotSheet.name)!;
      expect(renderSheet).toBeDefined();
      for (const [address, state] of Object.entries(snapshotSheet.cells as Record<string, { value: unknown; formula?: string }>)) {
        const cell = renderSheet.cells[address];
        if (!cell) throw new Error(`missing render cell ${snapshotSheet.name}!${address}`);
        if (state.formula !== undefined) {
          expect(cell.f).toBe(state.formula);
          // The basic read drops the cached <v>; the render model keeps it.
          expect(cell.c).toBeDefined();
          formulaCells += 1;
        } else {
          expect(cell.v).toEqual(state.value);
        }
      }
    }
    expect(formulaCells).toBeGreaterThan(0);
  });

  it("reads styles, theme-free defaults and the active tab", async () => {
    const { model } = await readFixture("xlsx-vietnamese.xlsx");
    expect(model.styles.length).toBeGreaterThan(0);
    const first = model.styles[0]!;
    expect(first.fontFamily).toBe("Calibri");
    expect(typeof first.bold).toBe("boolean");
    expect(first.diagonalUp).toBe(false);
    expect(model.activeTab).toBe(0);
    expect(model.date1904).toBe(false);
    const styled = model.sheets.flatMap((sheet) => Object.values(sheet.cells)).filter((cell) => cell.s !== undefined);
    expect(styled.length).toBeGreaterThan(0);
  });

  it("parses workbook defined names including scope and hidden flags (F1)", () => {
    const parsed = parseDefinedNamesXml(`<workbook><definedNames>
      <definedName name="Sales">PhuLuc!$B$2</definedName>
      <definedName name="Scoped" localSheetId="1">PhuLuc!$A$1</definedName>
      <definedName name="Hidden" hidden="1">Sheet1!$A$1</definedName>
      <definedName name="A&amp;B">Sheet1!$A$1</definedName>
      <definedName name="Empty"/>
    </definedNames></workbook>`);
    expect(parsed).toEqual([
      { name: "Sales", formula: "PhuLuc!$B$2" },
      { name: "Scoped", formula: "PhuLuc!$A$1", sheetIndex: 1 },
      { name: "Hidden", formula: "Sheet1!$A$1", hidden: true },
      { name: "A&B", formula: "Sheet1!$A$1" },
      { name: "Empty", formula: "" },
    ]);
    expect(parseDefinedNamesXml("<workbook><sheets/></workbook>")).toEqual([]);
  });

  it("marks a malformed localSheetId as unmodelable instead of re-scoping (F5)", () => {
    const parsed = parseDefinedNamesXml(`<workbook><definedNames>
      <definedName name="Blank" localSheetId="">Sheet1!$A$1</definedName>
      <definedName name="Garbage" localSheetId="abc">Sheet1!$A$1</definedName>
      <definedName name="Fraction" localSheetId="1.5">Sheet1!$A$1</definedName>
      <definedName name="Negative" localSheetId="-1">Sheet1!$A$1</definedName>
      <definedName name="Workbook">Sheet1!$A$1</definedName>
      <definedName name="Zero" localSheetId="0">Sheet1!$A$1</definedName>
    </definedNames></workbook>`);
    expect(parsed).toEqual([
      { name: "Blank", formula: "Sheet1!$A$1", sheetIndex: -1 },
      { name: "Garbage", formula: "Sheet1!$A$1", sheetIndex: -1 },
      { name: "Fraction", formula: "Sheet1!$A$1", sheetIndex: -1 },
      { name: "Negative", formula: "Sheet1!$A$1", sheetIndex: -1 },
      { name: "Workbook", formula: "Sheet1!$A$1" },
      { name: "Zero", formula: "Sheet1!$A$1", sheetIndex: 0 },
    ]);
  });

  it("surfaces the file's defined names on the render model (F1)", async () => {
    const { model } = await readFixture("xlsx-kitchen-sink.xlsx");
    expect(model.definedNames).toEqual([
      { name: "TongDoanhThu", formula: "PhuLuc!$B$2" },
      { name: "ChiTieu", formula: "PhuLuc!$A$2" },
    ]);
    const { model: vietnamese } = await readFixture("xlsx-vietnamese.xlsx");
    expect(vietnamese.definedNames).toEqual([{ name: "TongDoanhThu", formula: "PhuLuc!$B$2" }]);
  });

  it("counts cells for the payload bound", async () => {
    const { model } = await readFixture("xlsx-kitchen-sink.xlsx");
    expect(renderModelCellCount(model)).toBeGreaterThan(0);
  });
});

const d3 = (name: string) => join(D3_FIXTURES, name);
describeWithPatchedGateway("xlsx render model reader on the G3-D3 corpus", () => {
  loadEngine();
  if (!existsSync(d3("features.xlsx"))) return;
  it("features.xlsx carries merges, custom widths/heights and a frozen pane", async () => {
    const bytes = new Uint8Array(readFileSync(d3("features.xlsx")));
    const model = await readXlsxRenderModel(engine, bytes);
    const baoCao = model.sheets.find((sheet) => sheet.name === "Bao cao")!;
    expect(baoCao).toBeDefined();
    expect(baoCao.merges.length).toBeGreaterThanOrEqual(2);
    expect(baoCao.columnWidths.filter((column) => column.width !== undefined).length).toBeGreaterThanOrEqual(6);
    expect(baoCao.rowsMeta.filter((row) => row.height !== undefined).length).toBeGreaterThanOrEqual(3);
    expect(baoCao.freeze).toEqual({ frozenRows: 2, frozenColumns: 2 });
    expect(baoCao).toMatchObject({ conditionalRules: [{
      ranges: [{ startRow: 2, endRow: 6, startColumn: 3, endColumn: 3 }],
      ruleType: "cellIs", operator: "lessThan", formulas: ["500000000"], dxfIndex: 0, priority: 1,
    }] });
    expect(model.dxfStyles[0]).toMatchObject({ fontColor: "#9C0006", fillColor: "#FFC7CE" });
    expect(model.dxfStyles[0]?.fontFamily).toBeUndefined();
    const numberFormats = model.styles.filter((style) => style.numberFormat !== undefined);
    expect(numberFormats.length).toBeGreaterThan(0);
  });

  it("styled2000.xlsx keeps the styles referenced by cells", async () => {
    const bytes = new Uint8Array(readFileSync(d3("styled2000.xlsx")));
    const model = await readXlsxRenderModel(engine, bytes);
    const sheet = model.sheets[0]!;
    expect(sheet.cells.A1?.v).toBe("Cột 1");
    expect(sheet.cells.H1?.v).toBe("Cột 8");
    const styledCells = Object.values(sheet.cells).filter((cell) => cell.s !== undefined);
    expect(styledCells.length).toBeGreaterThan(1000);
    for (const cell of styledCells.slice(0, 50)) {
      expect(model.styles[cell.s!]).toBeDefined();
    }
  });

  it("large.xlsx reads 20k x 10 rows within the open bound", async () => {
    const bytes = new Uint8Array(readFileSync(d3("large.xlsx")));
    const started = Date.now();
    const model = await readXlsxRenderModel(engine, bytes);
    const elapsed = Date.now() - started;
    const sheet = model.sheets[0]!;
    expect(Object.keys(sheet.cells).length).toBeGreaterThan(199_000);
    expect(sheet.rowCount).toBeGreaterThanOrEqual(20_000);
    // Sanity bound for the service open job; the real budget is measured in
    // AC-5, this only catches a pathological regression.
    expect(elapsed).toBeLessThan(60_000);
  });
});
