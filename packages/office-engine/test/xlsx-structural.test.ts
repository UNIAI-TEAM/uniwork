// Structural (rows/columns) round-trip tests over the REAL patched gateway
// artifact — gated on .go-tmp/office-upstream-build/dist/xlsx-gateway.mjs
// (scripts/office/build-upstream.mjs). Every op kind is applied through the
// adapter's full path (parse → session model → serialize → gateway
// structuralOps → assemble), the output is reopened through the same gateway
// and the asserted structure is read back (cells via readWorkbook, row/col
// attributes via the worksheet part, shifted references via the chart part).
// Fixtures: kitchen-sink for formula/cross-sheet/chart shifting, the
// formula-free compatibility-edit workbook for removals, sizes, hidden flags,
// outline levels and the mixed envelope.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyXlsxEditBytes, bindXlsxGateway, createXlsxAdapter, type XlsxRecalcPort, type XlsxWorkbookSnapshot } from "../src/xlsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const ARTIFACT = join(REPO, ".go-tmp", "office-upstream-build", "dist", "xlsx-gateway.mjs");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");
const KITCHEN_SINK = "xlsx-kitchen-sink.xlsx";
const COMPAT_EDIT = "xlsx-compatibility-edit.xlsx";

type Gateway = Awaited<ReturnType<typeof load>>;
const load = async () => {
  const mod = await import(pathToFileURL(ARTIFACT).href);
  return bindXlsxGateway(mod as never);
};

const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** No-op recalc port: proves the structural save path never drives the native
 *  sidecar for coordinates the shift invalidated; calls are recorded so a
 *  regression fails loudly. */
function recordingRecalc(): XlsxRecalcPort & { calls: number } {
  const port = {
    calls: 0,
    async recalc() {
      port.calls += 1;
      return { cells: [], cached: false };
    },
    async close() {},
  };
  return port;
}

async function savedWith(
  engine: Gateway,
  name: string,
  ops: readonly Record<string, unknown>[],
  recalc?: XlsxRecalcPort,
) {
  const adapter = createXlsxAdapter(recalc === undefined ? { engine } : { engine, recalc });
  const opened = await adapter.open({ bytes: fixture(name), format: "xlsx", document_id: "structural" });
  if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
  adapter.edit(opened.document_model_ref, ops);
  const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
  adapter.release(opened.document_model_ref);
  return { bytes: saved.bytes, warnings: saved.warnings ?? [] };
}

const cells = (snapshot: XlsxWorkbookSnapshot, sheetName: string) =>
  snapshot.sheets.find((sheet) => sheet.name === sheetName)?.cells ?? {};

async function sheetXml(engine: Gateway, bytes: Uint8Array): Promise<string> {
  const xml = await engine.readEntryText(bytes, "xl/worksheets/sheet1.xml");
  if (xml === null) throw new Error("sheet1 part missing");
  return xml;
}

const rowXml = (xml: string, rowNumber: number): string =>
  new RegExp(`<row r="${rowNumber}"[^>]*>`).exec(xml)?.[0] ?? "";

const colXml = (xml: string, column: number): string =>
  new RegExp(`<col min="${column}" max="${column}"[^>]*/>`).exec(xml)?.[0] ?? "";

describe.skipIf(!existsSync(ARTIFACT))("xlsx structural ops on the real gateway", () => {
  it("insert_rows shifts values, rewrites formulas and moves ranged features", async () => {
    const engine = await load();
    const recalc = recordingRecalc();
    const saved = await savedWith(engine, KITCHEN_SINK, [
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ], recalc);
    // A formula-bearing workbook, but a structural save refills no caches:
    // the sidecar recalc must not run against pre-shift coordinates.
    expect(recalc.calls).toBe(0);
    expect(saved.warnings).toContainEqual(expect.objectContaining({ code: "structure_formula_cache_kept" }));
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").B3?.value).toBe(1_250_000_000);
    expect(cells(reopened.snapshot, "Data").B2?.value).toBe("Quý I");
    expect(cells(reopened.snapshot, "Data").B7?.formula).toBe("=SUM(B3:B5)");
    // Cross-sheet references move with the shift.
    expect(cells(reopened.snapshot, "PhuLuc").B2?.formula).toBe("=SUM(Data!B3:B5)");
    const xml = await sheetXml(engine, saved.bytes);
    expect(xml).toContain('sqref="A3:A5"');
    expect(xml).toContain('sqref="B3:B5"');
    // Chart series references (a preserved part) shift too.
    const chart = await engine.readEntryText(saved.bytes, "xl/charts/chart1.xml");
    expect(chart).toContain("<c:f>Data!$B$2</c:f>");
    expect(chart).toContain("<c:f>Data!$A$3:$A$5</c:f>");
    expect(chart).toContain("<c:f>Data!$B$3:$B$5</c:f>");
  });

  it("insert_cols shifts cells and formula references off the column axis", async () => {
    const engine = await load();
    const saved = await savedWith(engine, KITCHEN_SINK, [
      { op: "insert_cols", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ]);
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").C2?.value).toBe(1_250_000_000);
    expect(cells(reopened.snapshot, "Data").C5?.formula).toBe("=SUM(C2:C4)");
    expect(cells(reopened.snapshot, "Data").D5?.formula).toBe("=SUM(D2:D4)");
    expect(cells(reopened.snapshot, "PhuLuc").B2?.formula).toBe("=SUM(Data!C2:C4)");
    const xml = await sheetXml(engine, saved.bytes);
    expect(xml).toContain('sqref="B2:B4"');
    expect(xml).toContain('sqref="C2:C4"');
  });

  it("remove_rows renumbers rows, drops the removed one and shrinks ranged features", async () => {
    const engine = await load();
    const saved = await savedWith(engine, COMPAT_EDIT, [
      { op: "remove_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ]);
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").A1?.value).toBe("Doanh thu");
    expect(cells(reopened.snapshot, "Data").B1?.value).toBe(1_250_000_000);
    expect(cells(reopened.snapshot, "Data").C1?.value).toBe(780_000_000);
    const xml = await sheetXml(engine, saved.bytes);
    expect(xml).not.toContain('<row r="5"');
    expect(xml).toContain('sqref="A1:A3"');
    expect(xml).toContain('sqref="B1:B3"');
  });

  it("remove_cols drops the removed column, its references and its validation", async () => {
    const engine = await load();
    const saved = await savedWith(engine, COMPAT_EDIT, [
      { op: "remove_cols", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ]);
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").A1?.value).toBe("Quý I");
    expect(cells(reopened.snapshot, "Data").A2?.value).toBe(1_250_000_000);
    expect(cells(reopened.snapshot, "Data").B2?.value).toBe(780_000_000);
    const xml = await sheetXml(engine, saved.bytes);
    // The data validation's whole sqref was the deleted column: it goes.
    expect(xml).not.toContain("<dataValidation");
    expect(xml).toContain('<conditionalFormatting sqref="A2:A4">');
  });

  it("sizes, hidden flags and outline levels land as row/col attributes", async () => {
    const engine = await load();
    const saved = await savedWith(engine, COMPAT_EDIT, [
      { op: "set_row_size", target: { sheet: "Data" }, attributes: { start: 1, end: 2, size: 30 } },
      { op: "set_col_size", target: { sheet: "Data" }, attributes: { start: 2, end: 2, size: 12 } },
      { op: "set_rows_hidden", target: { sheet: "Data" }, attributes: { start: 3, end: 3, hidden: true } },
      { op: "set_cols_hidden", target: { sheet: "Data" }, attributes: { start: 0, end: 0, hidden: true } },
      { op: "set_rows_outline", target: { sheet: "Data" }, attributes: { start: 1, end: 3, level: 2, collapsed: false } },
      { op: "set_cols_outline", target: { sheet: "Data" }, attributes: { start: 1, end: 2, level: 1 } },
    ]);
    const xml = await sheetXml(engine, saved.bytes);
    expect(rowXml(xml, 2)).toContain('ht="30"');
    expect(rowXml(xml, 3)).toContain('customHeight="1"');
    expect(rowXml(xml, 4)).toContain('hidden="1"');
    expect(rowXml(xml, 4)).toContain('outlineLevel="2"');
    expect(colXml(xml, 3)).toContain('width="12"');
    expect(colXml(xml, 1)).toContain('hidden="1"');
    expect(colXml(xml, 2)).toContain('outlineLevel="1"');
    expect(xml).toContain('outlineLevelRow="2"');
    expect(xml).toContain('outlineLevelCol="1"');
    // A pure attribute edit leaves the data untouched.
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").B2?.value).toBe(1_250_000_000);
  });

  it("a mixed cell+structural envelope replays structure first, then the shifted cell edit", async () => {
    const engine = await load();
    // The envelope order the renderer's journal produces: a cell edit queued
    // before the shift. The session model must move it into the op's
    // post-operation space, or the gateway would write it one row too high.
    const saved = await savedWith(engine, COMPAT_EDIT, [
      { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 42 } },
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ]);
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").B3?.value).toBe(42);
    // The header row shifted down onto the edit's pre-shift address; the edit
    // itself moved to B3, so it must not have overwritten the header.
    expect(cells(reopened.snapshot, "Data").B2?.value).toBe("Quý I");
    expect(cells(reopened.snapshot, "Data").C3?.value).toBe(780_000_000);
    expect(cells(reopened.snapshot, "Data").B6?.value).toBe(1_570_000_000);
  });

  it("refuses an envelope over the op bound before any byte is assembled", async () => {
    const engine = await load();
    const ops = Array.from({ length: 20_001 }, () => ({
      op: "insert_rows",
      target: { sheet: "Data" },
      attributes: { index: 0, count: 1 },
    }));
    await expect(
      applyXlsxEditBytes(engine, undefined, fixture(COMPAT_EDIT), ops, "test-build"),
    ).rejects.toMatchObject({ code: "engine_result_invalid" });
  });
});
