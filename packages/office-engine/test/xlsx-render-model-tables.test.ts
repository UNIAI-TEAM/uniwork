// UNI-926 FB-3: tables a workbook ships (worksheet <tableParts> -> rels ->
// xl/tables/tableN.xml) reach the render model per sheet. The package is a
// map of part texts behind a stub engine, so no zip fixture is needed.
import { describe, expect, it } from "vitest";
import { readXlsxRenderModel, type XlsxGatewayFunctions } from "../src/xlsx";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const WORKBOOK = `<workbook ${NS}><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Plain" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const WORKBOOK_RELS = `<Relationships><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
const SHEET_WITH_TABLES = (ids: string[]): string =>
  `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData><tableParts count="${ids.length}">${ids.map((id) => `<tablePart r:id="${id}"/>`).join("")}</tableParts></worksheet>`;
const SHEET_PLAIN = `<worksheet ${NS}><sheetData/></worksheet>`;

const TABLE_SALES = `<table ${NS} id="1" name="Sales" displayName="Sales" ref="B2:D6" totalsRowShown="0"><autoFilter ref="B2:D6"/><tableColumns count="3"><tableColumn id="1" name="Region"/><tableColumn id="2" name="Q1 &amp; Q2"/><tableColumn id="3" name="Total"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
const TABLE_TOTALS = `<table ${NS} id="2" name="Costs" displayName="Costs" ref="F1:G4" headerRowCount="1" totalsRowCount="1"><tableColumns count="2"><tableColumn id="1" name="Item"/><tableColumn id="2" name="Cost"/></tableColumns><tableStyleInfo showRowStripes="0"/></table>`;

function stubEngine(parts: Record<string, string>): XlsxGatewayFunctions {
  return {
    async readWorkbook() {
      return { sheetNamesById: { "sheet-1": "Data", "sheet-2": "Plain" }, snapshot: { revision: 7, sheets: [] } };
    },
    async readEntriesText(_bytes: Uint8Array, paths: readonly string[]) {
      const out: Record<string, string | null> = {};
      for (const path of paths) out[path] = parts[path] ?? null;
      return out;
    },
  } as unknown as XlsxGatewayFunctions;
}

const read = (parts: Record<string, string>) => readXlsxRenderModel(stubEngine(parts), new Uint8Array());

const base = (extra: Record<string, string>): Record<string, string> => ({
  "xl/workbook.xml": WORKBOOK,
  "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
  "xl/worksheets/sheet1.xml": SHEET_WITH_TABLES(["rId1", "rId2"]),
  "xl/worksheets/sheet2.xml": SHEET_PLAIN,
  "xl/worksheets/_rels/sheet1.xml.rels": `<Relationships><Relationship Id="rId1" Type="${REL}/table" Target="../tables/table1.xml"/><Relationship Id="rId2" Type="${REL}/table" Target="/xl/tables/table2.xml"/></Relationships>`,
  ...extra,
});

describe("xlsx render model: file-native tables", () => {
  it("reads name, area, columns, style and flags per sheet", async () => {
    const model = await read(base({ "xl/tables/table1.xml": TABLE_SALES, "xl/tables/table2.xml": TABLE_TOTALS }));
    const [data, plain] = model.sheets;
    expect(data?.tables).toEqual([
      {
        name: "Sales",
        area: { startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 },
        columnNames: ["Region", "Q1 & Q2", "Total"],
        style: "TableStyleMedium2",
        bandedRows: true,
        headerRow: true,
        totalsRow: false,
      },
      {
        name: "Costs",
        area: { startRow: 0, startColumn: 5, endRow: 3, endColumn: 6 },
        columnNames: ["Item", "Cost"],
        bandedRows: false,
        headerRow: true,
        totalsRow: true,
      },
    ]);
    expect(plain?.tables).toEqual([]);
  });

  it("drops a missing or malformed table part without throwing", async () => {
    const model = await read(base({ "xl/tables/table1.xml": "<table name=", "xl/tables/table2.xml": TABLE_TOTALS.replace('ref="F1:G4"', 'ref="nope"') }));
    expect(model.sheets[0]?.tables).toEqual([]);
    const missing = await read(base({ "xl/tables/table1.xml": TABLE_SALES }));
    expect(missing.sheets[0]?.tables?.map((table) => table.name)).toEqual(["Sales"]);
  });

  it("reads no tables without worksheet relationships or when the entry reader fails", async () => {
    const noRels = base({ "xl/tables/table1.xml": TABLE_SALES });
    delete noRels["xl/worksheets/_rels/sheet1.xml.rels"];
    expect((await read(noRels)).sheets[0]?.tables).toEqual([]);

    const engine = stubEngine(base({ "xl/tables/table1.xml": TABLE_SALES }));
    const real = engine.readEntriesText.bind(engine);
    let calls = 0;
    (engine as { readEntriesText: unknown }).readEntriesText = async (bytes: Uint8Array, paths: readonly string[]) => {
      calls += 1;
      // The workbook and worksheet reads succeed; the rels/table reads fail.
      if (calls > 2) throw new Error("boom");
      return real(bytes, paths);
    };
    const failed = await readXlsxRenderModel(engine, new Uint8Array());
    expect(failed.sheets[0]?.tables).toEqual([]);
    expect(failed.sheets[0]?.name).toBe("Data");
  });
});
