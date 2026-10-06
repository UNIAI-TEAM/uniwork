// UNI-926 FB-3: tables a workbook ships (worksheet <tableParts> -> rels ->
// xl/tables/tableN.xml) reach the render model per sheet. The package is a
// map of part texts behind a stub engine, so no zip fixture is needed (the last block does use real zip bytes).
import { deflateRawSync, inflateRawSync } from "node:zlib";
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

  it("falls back to an unprefixed id on a tablePart", async () => {
    const parts = base({ "xl/tables/table1.xml": TABLE_SALES, "xl/tables/table2.xml": TABLE_TOTALS });
    parts["xl/worksheets/sheet1.xml"] = SHEET_WITH_TABLES(["rId1"]).replace('r:id="rId1"', 'id="rId1"');
    expect((await read(parts)).sheets[0]?.tables?.map((table) => table.name)).toEqual(["Sales"]);
  });

  it("prefers displayName over name", async () => {
    const renamed = TABLE_SALES.replace('name="Sales" displayName="Sales"', 'name="Old_Name" displayName="Sales_Display"');
    expect((await read(base({ "xl/tables/table1.xml": renamed }))).sheets[0]?.tables?.[0]?.name).toBe("Sales_Display");
    const nameOnly = TABLE_SALES.replace(' displayName="Sales"', "");
    expect((await read(base({ "xl/tables/table1.xml": nameOnly }))).sheets[0]?.tables?.[0]?.name).toBe("Sales");
  });

  it("honours totalsRowShown: an explicit off hides the totals row", async () => {
    const totals = async (attrs: string): Promise<boolean | undefined> => {
      const xml = TABLE_TOTALS.replace('totalsRowCount="1"', `totalsRowCount="1"${attrs}`);
      return (await read(base({ "xl/tables/table2.xml": xml }))).sheets[0]?.tables?.[0]?.totalsRow;
    };
    expect(await totals("")).toBe(true);
    expect(await totals(' totalsRowShown="1"')).toBe(true);
    expect(await totals(' totalsRowShown="0"')).toBe(false);
    expect(await totals(' totalsRowShown="false"')).toBe(false);
  });
});

// A real stored/deflated zip (central directory + local headers), read back by
// a minimal reader behind the same entry-reader seam the engine exposes.
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipOf(entries: Record<string, string>): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, "utf8");
    const packed = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc32(raw), 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBytes);
    chunks.push(local, nameBytes, packed);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, directory, end]));
}

function unzipText(bytes: Uint8Array, wanted: readonly string[]): Record<string, string | null> {
  const buf = Buffer.from(bytes);
  const out: Record<string, string | null> = Object.fromEntries(wanted.map((path) => [path, null]));
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let cursor = buf.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    const packedSize = buf.readUInt32LE(cursor + 20);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength;
    if (!wanted.includes(name)) continue;
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    out[name] = inflateRawSync(buf.subarray(start, start + packedSize)).toString("utf8");
  }
  return out;
}

describe("xlsx render model: tables from a real zip package", () => {
  it("reads a table end to end out of real zip bytes", async () => {
    const bytes = zipOf(base({ "xl/tables/table1.xml": TABLE_SALES, "xl/tables/table2.xml": TABLE_TOTALS }));
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const engine = {
      async readWorkbook() {
        return { sheetNamesById: { "sheet-1": "Data", "sheet-2": "Plain" }, snapshot: { revision: 7, sheets: [] } };
      },
      async readEntriesText(zip: Uint8Array, paths: readonly string[]) {
        return unzipText(zip, paths);
      },
    } as unknown as XlsxGatewayFunctions;
    const model = await readXlsxRenderModel(engine, bytes);
    const sales = model.sheets[0]?.tables?.[0];
    expect(sales?.name).toBe("Sales");
    expect(sales?.area).toEqual({ startRow: 1, startColumn: 1, endRow: 5, endColumn: 3 });
    expect(sales?.columnNames).toEqual(["Region", "Q1 & Q2", "Total"]);
    expect(sales?.headerRow).toBe(true);
    expect(model.sheets[0]?.tables).toHaveLength(2);
    expect(model.sheets[1]?.tables).toEqual([]);
  });
});
