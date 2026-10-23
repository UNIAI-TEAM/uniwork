// UNI-926 R3-1B: shared-formula FOLLOWER cells (`<f t="shared" si="0"/>`) must
// get a refreshed cached <v> on save, like their master. The gateway is the
// REAL artifact; the fixture workbook is built here with a tiny STORE zip
// writer; the only fake is the recalc port, which (like IronCalc) understands
// shared formulas: every cell whose XML carries an <f> (master or follower)
// is a formula cell, evaluated from the CURRENT values (file literals overlaid
// by the request's edits).
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bindXlsxGateway, createXlsxAdapter, type XlsxRecalcEdit, type XlsxRecalcPort, type XlsxRecalcRead } from "../src/xlsx";
import { ARTIFACT, describeWithPatchedGateway } from "./xlsx-patched-gateway";
import { a1ToRowColumn } from "../src/xlsx/ops-shared";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");

type Gateway = Awaited<ReturnType<typeof load>>;
type Adapter = ReturnType<typeof createXlsxAdapter>;
const load = async () => {
  const mod = await import(pathToFileURL(ARTIFACT).href);
  return bindXlsxGateway(mod as never);
};

// ---- minimal STORE zip writer -------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zipStore(entries: readonly (readonly [string, string])[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const num = (address: string, value: number) => `<c r="${address}"><v>${value}</v></c>`;
const master = (address: string, ref: string, si: number, text: string, stale: number) =>
  `<c r="${address}"><f t="shared" ref="${ref}" si="${si}">${text}</f><v>${stale}</v></c>`;
const follower = (address: string, si: number, stale: number) =>
  `<c r="${address}"><f t="shared" si="${si}"/><v>${stale}</v></c>`;
const row = (n: number, cells: string) => `<row r="${n}">${cells}</row>`;
const sheetDoc = (rows: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;

interface FixtureOptions {
  /** Prefix the workbook binds the officeDocument relationships namespace to.
   *  Any prefix is legal; the gateway resolves the sheet rel id by <sheet>. */
  readonly relationshipPrefix?: string;
  /** The worksheet Relationship Type. The gateway resolves the worksheet part
   *  by Id alone, so a Type that does not end /worksheet is still valid. */
  readonly worksheetRelationshipType?: string;
}

/** Stale caches are 1 everywhere; the correct ones are derived from B. */
function buildFixture(options: FixtureOptions = {}): Uint8Array {
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const prefix = options.relationshipPrefix ?? "r";
  const worksheetType = options.worksheetRelationshipType ?? `${rel}/worksheet`;
  const data = sheetDoc(
    row(2, num("B2", 10) + master("C2", "C2:C5", 0, "B2*2", 1) + master("D2", "D2:D3", 1, "B2+1", 1)) +
      row(3, num("B3", 20) + follower("C3", 0, 1) + follower("D3", 1, 1)) +
      row(4, num("B4", 30) + follower("C4", 0, 1)) +
      row(5, num("B5", 40) + follower("C5", 0, 1)),
  );
  const other = sheetDoc(
    row(1, num("B1", 3) + master("C1", "C1:C2", 0, "B1*2", 1)) + row(2, num("B2", 4) + follower("C2", 0, 1)),
  );
  const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ct = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  return zipStore([
    [
      "[Content_Types].xml",
      `${decl}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${ct}.worksheet+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `${decl}<workbook ${NS} xmlns:${prefix}="${rel}"><sheets><sheet name="Data" sheetId="1" ${prefix}:id="rId1"/><sheet name="Other" sheetId="2" ${prefix}:id="rId2"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${worksheetType}" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${worksheetType}" Target="worksheets/sheet2.xml"/></Relationships>`,
    ],
    ["xl/worksheets/sheet1.xml", data],
    ["xl/worksheets/sheet2.xml", other],
  ]);
}

// ---- helpers shared with xlsx-recalc-after-assemble.test.ts ---------------
interface RecalcCall {
  readonly bytes: Uint8Array;
  readonly edits: readonly XlsxRecalcEdit[];
  readonly reads: readonly XlsxRecalcRead[];
  readonly answered: string[];
}

/** The worksheet part XML of a sheet, resolved through workbook.xml + rels. */
async function sheetXml(engine: Gateway, bytes: Uint8Array, sheetName: string): Promise<string> {
  const workbook = (await engine.readEntryText(bytes, "xl/workbook.xml")) ?? "";
  const rels = (await engine.readEntryText(bytes, "xl/_rels/workbook.xml.rels")) ?? "";
  const tag = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`name="${sheetName}"`));
  // Any relationships prefix is legal; mirror the production reader.
  const rid =
    /r:id="([^"]+)"/.exec(tag ?? "")?.[1] ?? /[A-Za-z_][\w.-]*:id="([^"]+)"/.exec(tag ?? "")?.[1];
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`));
  const target = /Target="([^"]+)"/.exec(rel ?? "")?.[1];
  if (target === undefined) throw new Error(`no worksheet part for ${sheetName}`);
  const xml = await engine.readEntryText(bytes, "xl/" + target.replace(/^\/?(xl\/)?/, ""));
  if (xml === null) throw new Error(`worksheet part ${target} missing`);
  return xml;
}

const cellXml = (xml: string, address: string): string =>
  new RegExp(`<c r="${address}"(?:[^>]*/>|[^>]*>.*?</c>)`).exec(xml)?.[0] ?? "";
const cachedValue = (xml: string, address: string): string | undefined =>
  /<v>([^<]*)<\/v>/.exec(cellXml(xml, address))?.[1];

/** Every `<c>` whose body carries an <f> (master or follower). */
function formulaAddresses(xml: string): { address: string; row: number; column: number }[] {
  const found = [];
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>(.*?)<\/c>)/g)) {
    if (m[2] === undefined || !/<f[\s/>]/.test(m[2])) continue;
    const at = a1ToRowColumn(m[1]!, "<test>", "address");
    found.push({ address: m[1]!, row: at.row, column: at.column });
  }
  return found;
}

/** Answers every formula cell (shared master OR follower) of the bytes it is
 *  handed inside the requested ranges, evaluated from current values; `skip`
 *  names "Sheet row,column" cells it leaves unanswered. */
function sharedAwareRecalc(engine: Gateway, skip: ReadonlySet<string> = new Set()): XlsxRecalcPort & { calls: RecalcCall[] } {
  const port = {
    calls: [] as RecalcCall[],
    async recalc(bytes: Uint8Array, edits: readonly XlsxRecalcEdit[], reads: readonly XlsxRecalcRead[]) {
      const call: RecalcCall = { bytes, edits, reads, answered: [] };
      port.calls.push(call);
      const { snapshot } = await engine.readWorkbook(bytes);
      const cells = [];
      for (const read of reads) {
        const literals = snapshot.sheets.find((s) => s.name === read.sheet)?.cells ?? {};
        const valueAt = (r: number, c: number): number => {
          const edited = edits.find((e) => e.sheet === read.sheet && e.row === r && e.column === c);
          if (edited !== undefined) return Number(edited.input);
          for (const [address, cell] of Object.entries(literals)) {
            const at = a1ToRowColumn(address, "<test>", "address");
            if (at.row === r && at.column === c) return Number(cell.value);
          }
          return 0;
        };
        for (const f of formulaAddresses(await sheetXml(engine, bytes, read.sheet))) {
          const { startRow, endRow, startColumn, endColumn } = read.range;
          if (f.row < startRow || f.row > endRow || f.column < startColumn || f.column > endColumn) continue;
          if (skip.has(`${read.sheet} ${f.row},${f.column}`)) continue;
          // Hard-coded per column: C = 2*B, D = B+1 (same row), on both sheets.
          const b = valueAt(f.row, 1);
          const n = f.column === 2 ? 2 * b : f.column === 3 ? b + 1 : Number.NaN;
          if (Number.isNaN(n)) throw new Error(`unexpected formula cell ${read.sheet}!${f.address}`);
          call.answered.push(`${read.sheet}!${f.address}`);
          cells.push({ sheet: read.sheet, row: f.row, column: f.column, formatted: String(n), number: n, isError: false, isFormula: true });
        }
      }
      return { cells, cached: false };
    },
    async close() {},
  };
  return port;
}

async function openSession(adapter: Adapter, bytes: Uint8Array): Promise<string> {
  const opened = await adapter.open({ bytes, format: "xlsx", document_id: "shared-formulas" });
  if (opened.outcome !== "opened") throw new Error(`fixture_open_failed: ${JSON.stringify(opened)}`);
  return opened.document_model_ref;
}

async function save(adapter: Adapter, ref: string, ops: readonly Record<string, unknown>[]) {
  adapter.edit(ref, ops);
  const saved = await adapter.serialize({ document_model_ref: ref, format: "xlsx" });
  return { bytes: saved.bytes, warnings: (saved.warnings ?? []) as { code: string; detail: string }[] };
}

const setCell = (sheet: string, cell: string, value: number) => ({ op: "set_cell", target: { sheet, cell }, attributes: { value } });

/** Asserts the cached <v> of each member AND that followers still read
 *  exactly `<f t="shared" si="N"/>` (not expanded) while masters keep their ref. */
function expectGroup(
  xml: string,
  members: readonly { address: string; value: number; si: number; master?: string }[],
): void {
  for (const m of members) {
    const cell = cellXml(xml, m.address);
    expect(cachedValue(xml, m.address), `${m.address} cached <v> in ${cell}`).toBe(String(m.value));
    if (m.master === undefined) expect(cell, m.address).toContain(`<f t="shared" si="${m.si}"/>`);
    else expect(cell, m.address).toContain(`<f t="shared" ref="${m.master}" si="${m.si}">`);
  }
}

describeWithPatchedGateway("xlsx shared-formula follower caches (R3-1B)", () => {
  it("opens the fixture with followers as plain literals and masters as formulas", async () => {
    const engine = await load();
    const { snapshot } = await engine.readWorkbook(buildFixture());
    const data = snapshot.sheets.find((s) => s.name === "Data")?.cells ?? {};
    expect(data.C2?.formula).toBeDefined();
    expect(data.D2?.formula).toBeDefined();
    expect(data.C3?.formula).toBeUndefined();
    expect(data.C4?.formula).toBeUndefined();
    expect(data.D3?.formula).toBeUndefined();
    const other = snapshot.sheets.find((s) => s.name === "Other")?.cells ?? {};
    expect(other.C1?.formula).toBeDefined();
    expect(other.C2?.formula).toBeUndefined();
  });

  it("a. refreshes master and every follower on the plain-cell save path", async () => {
    const engine = await load();
    const recalc = sharedAwareRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, buildFixture());
    const saved = await save(adapter, ref, [setCell("Data", "B3", 100), setCell("Other", "B2", 5)]);
    expect(saved.warnings.some((w) => w.code === "formula_cache_kept")).toBe(false);
    const data = await sheetXml(engine, saved.bytes, "Data");
    expect(cellXml(data, "C2")).toContain(">B2*2</f>");
    expect(cellXml(data, "D2")).toContain(">B2+1</f>");
    expectGroup(data, [
      { address: "C2", value: 20, si: 0, master: "C2:C5" },
      { address: "C3", value: 200, si: 0 },
      { address: "C4", value: 60, si: 0 },
      { address: "C5", value: 80, si: 0 },
      { address: "D2", value: 11, si: 1, master: "D2:D3" },
      { address: "D3", value: 101, si: 1 },
    ]);
    expectGroup(await sheetXml(engine, saved.bytes, "Other"), [
      { address: "C1", value: 6, si: 0, master: "C1:C2" },
      { address: "C2", value: 10, si: 0 },
    ]);
  });

  it("b. refreshes followers at their shifted coordinates after insert_rows", async () => {
    const engine = await load();
    const recalc = sharedAwareRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, buildFixture());
    // 0-based index 3 = a new row 4, between the C3 and C4 members.
    const saved = await save(adapter, ref, [
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 3, count: 1 } },
    ]);
    expect(recalc.calls.at(-1)?.edits).toEqual([]);
    const data = await sheetXml(engine, saved.bytes, "Data");
    // Rows 4 and 5 moved to 5 and 6: the gateway grows the master's ref over
    // the inserted row and leaves every follower's <f/> as written.
    expectGroup(data, [
      { address: "C2", value: 20, si: 0, master: "C2:C6" },
      { address: "C3", value: 40, si: 0 },
      { address: "C5", value: 60, si: 0 },
      { address: "C6", value: 80, si: 0 },
      { address: "D2", value: 11, si: 1, master: "D2:D3" },
      { address: "D3", value: 21, si: 1 },
    ]);
  });

  it("c. refreshes followers under the new name after rename_sheet + an edit", async () => {
    const engine = await load();
    const recalc = sharedAwareRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, buildFixture());
    const saved = await save(adapter, ref, [
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Dữ liệu" } },
      setCell("Dữ liệu", "B4", 50),
    ]);
    expectGroup(await sheetXml(engine, saved.bytes, "Dữ liệu"), [
      { address: "C2", value: 20, si: 0, master: "C2:C5" },
      { address: "C3", value: 40, si: 0 },
      { address: "C4", value: 100, si: 0 },
      { address: "C5", value: 80, si: 0 },
      { address: "D2", value: 11, si: 1, master: "D2:D3" },
      { address: "D3", value: 21, si: 1 },
    ]);
    expectGroup(await sheetXml(engine, saved.bytes, "Other"), [
      { address: "C1", value: 6, si: 0, master: "C1:C2" },
      { address: "C2", value: 8, si: 0 },
    ]);
  });

  it("c2. refreshes followers after reorder_sheet", async () => {
    const engine = await load();
    const recalc = sharedAwareRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, buildFixture());
    const saved = await save(adapter, ref, [
      { op: "reorder_sheet", target: { sheet: "Other" }, attributes: { index: 0 } },
      setCell("Data", "B5", 7),
    ]);
    expectGroup(await sheetXml(engine, saved.bytes, "Data"), [
      { address: "C3", value: 40, si: 0 },
      { address: "C5", value: 14, si: 0 },
      { address: "D3", value: 21, si: 1 },
    ]);
    expectGroup(await sheetXml(engine, saved.bytes, "Other"), [{ address: "C2", value: 8, si: 0 }]);
  });

  it("d. refreshes followers on two saves in a row of the same session", async () => {
    const engine = await load();
    const recalc = sharedAwareRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, buildFixture());
    const first = await save(adapter, ref, [setCell("Data", "B3", 100)]);
    expect(cachedValue(await sheetXml(engine, first.bytes, "Data"), "C3")).toBe("200");
    const second = await save(adapter, ref, [setCell("Data", "B4", 5), setCell("Data", "B3", 1)]);
    expectGroup(await sheetXml(engine, second.bytes, "Data"), [
      { address: "C2", value: 20, si: 0, master: "C2:C5" },
      { address: "C3", value: 2, si: 0 },
      { address: "C4", value: 10, si: 0 },
      { address: "C5", value: 80, si: 0 },
      { address: "D2", value: 11, si: 1, master: "D2:D3" },
      { address: "D3", value: 2, si: 1 },
    ]);
  });

  it("e. keeps the file <v> and warns when the recalc port skips one follower", async () => {
    const engine = await load();
    const recalc = sharedAwareRecalc(engine, new Set(["Data 3,2"])); // Data!C4
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, buildFixture());
    const saved = await save(adapter, ref, [setCell("Data", "B3", 100)]);
    expect(saved.warnings).toContainEqual(expect.objectContaining({ code: "formula_cache_kept" }));
    expectGroup(await sheetXml(engine, saved.bytes, "Data"), [
      { address: "C3", value: 200, si: 0 },
      { address: "C4", value: 1, si: 0 }, // unanswered: the file's stale cache
      { address: "C5", value: 80, si: 0 },
    ]);
  });

  it("f. a literal typed over a follower becomes a literal; the rest still refresh", async () => {
    const engine = await load();
    const recalc = sharedAwareRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, buildFixture());
    const saved = await save(adapter, ref, [setCell("Data", "C4", 7), setCell("Data", "B3", 100)]);
    const data = await sheetXml(engine, saved.bytes, "Data");
    expect(cellXml(data, "C4")).not.toContain("<f");
    expect(cachedValue(data, "C4")).toBe("7");
    expectGroup(data, [
      { address: "C2", value: 20, si: 0, master: "C2:C5" },
      { address: "C3", value: 200, si: 0 },
      { address: "C5", value: 80, si: 0 },
      { address: "D3", value: 101, si: 1 },
    ]);
  });

  it("g. resolves followers when the workbook binds the rels namespace to a non-r prefix", async () => {
    const engine = await load();
    const recalc = sharedAwareRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, buildFixture({ relationshipPrefix: "foo" }));
    const saved = await save(adapter, ref, [setCell("Data", "B3", 100), setCell("Other", "B2", 5)]);
    expect(saved.warnings.some((w) => w.code === "formula_cache_kept")).toBe(false);
    const data = await sheetXml(engine, saved.bytes, "Data");
    expect(cellXml(data, "C2")).toContain(">B2*2</f>");
    expectGroup(data, [
      { address: "C2", value: 20, si: 0, master: "C2:C5" },
      { address: "C3", value: 200, si: 0 },
      { address: "C4", value: 60, si: 0 },
      { address: "C5", value: 80, si: 0 },
      { address: "D2", value: 11, si: 1, master: "D2:D3" },
      { address: "D3", value: 101, si: 1 },
    ]);
    expectGroup(await sheetXml(engine, saved.bytes, "Other"), [
      { address: "C1", value: 6, si: 0, master: "C1:C2" },
      { address: "C2", value: 10, si: 0 },
    ]);
  });

  it("h. resolves followers when the worksheet Relationship Type is not /worksheet", async () => {
    const engine = await load();
    const recalc = sharedAwareRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(
      adapter,
      buildFixture({ worksheetRelationshipType: "http://example.invalid/rels/spreadsheetPart" }),
    );
    const saved = await save(adapter, ref, [setCell("Data", "B3", 100), setCell("Other", "B2", 5)]);
    expect(saved.warnings.some((w) => w.code === "formula_cache_kept")).toBe(false);
    const data = await sheetXml(engine, saved.bytes, "Data");
    expectGroup(data, [
      { address: "C2", value: 20, si: 0, master: "C2:C5" },
      { address: "C3", value: 200, si: 0 },
      { address: "C4", value: 60, si: 0 },
      { address: "C5", value: 80, si: 0 },
      { address: "D3", value: 101, si: 1 },
    ]);
    expectGroup(await sheetXml(engine, saved.bytes, "Other"), [
      { address: "C1", value: 6, si: 0, master: "C1:C2" },
      { address: "C2", value: 10, si: 0 },
    ]);
  });
});
