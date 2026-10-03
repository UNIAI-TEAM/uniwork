// Merge/unmerge (B2) tests. The model/parser half runs anywhere; the
// round-trips run over the REAL patched gateway artifact — the same harness
// xlsx-structural.test.ts uses. Merges never shift coordinates, so the
// envelope replays them in emission order and a later row/column op shifts the
// merged range in the gateway exactly as the renderer shows it. Neither
// fixture carries a merge, so the unmerge case is a two-save chain: merge,
// reopen the produced bytes, unmerge.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bindXlsxGateway,
  createXlsxAdapter,
  createXlsxSessionModel,
  parseXlsxOps,
  XlsxOpError,
  type XlsxRecalcPort,
  type XlsxWorkbookSnapshot,
} from "../src/xlsx";

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

async function saveOps(
  engine: Gateway,
  source: Uint8Array,
  ops: readonly Record<string, unknown>[],
  recalc?: XlsxRecalcPort,
) {
  const adapter = createXlsxAdapter(recalc === undefined ? { engine } : { engine, recalc });
  const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "merge" });
  if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
  adapter.edit(opened.document_model_ref, ops);
  const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
  adapter.release(opened.document_model_ref);
  return { bytes: saved.bytes, warnings: saved.warnings ?? [] };
}

const savedWith = (engine: Gateway, name: string, ops: readonly Record<string, unknown>[], recalc?: XlsxRecalcPort) =>
  saveOps(engine, fixture(name), ops, recalc);

const cells = (snapshot: XlsxWorkbookSnapshot, sheetName: string) =>
  snapshot.sheets.find((sheet) => sheet.name === sheetName)?.cells ?? {};

async function sheetXml(engine: Gateway, bytes: Uint8Array): Promise<string> {
  const xml = await engine.readEntryText(bytes, "xl/worksheets/sheet1.xml");
  if (xml === null) throw new Error("sheet1 part missing");
  return xml;
}

const baseSnapshot = (): XlsxWorkbookSnapshot => ({
  revision: 0,
  sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 2 } } }],
});

function modelWith(operations: unknown[]) {
  const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
  for (const op of parseXlsxOps(operations, model.resolver({ "sheet-1": "Data" }))) model.applyEdit(op);
  return model;
}

describe("XLSX merge ops in the session model", () => {
  it("records merges in emission order, grouped per sheet, without shifting pending cells", () => {
    const model = modelWith([
      { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 42 } },
      { op: "merge_cells", target: { sheet: "Data" }, range: "A1:C3" },
      { op: "unmerge_cells", target: { sheet: "Data" }, range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 } },
    ]);
    expect(model.pendingStructuralOps()).toEqual([
      {
        sheetName: "Data",
        ops: [
          { kind: "merge-cells", range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 } },
          { kind: "unmerge-cells", range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 } },
        ],
      },
    ]);
    expect(model.pendingEdits()).toEqual([
      { sheetName: "Data", row: 1, column: 1, writeValue: true, cell: { value: 42 } },
    ]);
  });

  it("keeps the merge op in emission coordinates while a later row insert shifts pending cells", () => {
    const model = modelWith([
      { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 42 } },
      { op: "merge_cells", target: { sheet: "Data" }, range: "A1:C3" },
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ]);
    const [group] = model.pendingStructuralOps();
    expect(group?.ops.map((op) => op.kind)).toEqual(["merge-cells", "insert-rows"]);
    // The insert shifts the pending cell; the gateway shifts the merge's ref
    // when it replays the insert after the merge.
    expect(model.pendingEdits()[0]).toMatchObject({ row: 2, column: 1 });
    expect(group?.ops[0]).toEqual({ kind: "merge-cells", range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 } });
  });

  it("refuses malformed merge ranges before any op reaches the model", () => {
    const cases: readonly Record<string, unknown>[] = [
      { op: "merge_cells", target: { sheet: "Data" }, range: "A1:A1" },
      { op: "merge_cells", target: { sheet: "Data" }, range: "B2:A1" },
      { op: "merge_cells", target: { sheet: "Data" }, range: "A1" },
      { op: "merge_cells", target: { sheet: "Data" }, range: "A1:B2:C3" },
      { op: "merge_cells", target: { sheet: "Data" }, range: { startRow: 0, startColumn: 0, endRow: 0, endColumn: 16_384 } },
      { op: "unmerge_cells", target: { sheet: "Data" }, range: { startRow: 0, startColumn: 0, endRow: 1.5, endColumn: 1 } },
      { op: "merge_cells", target: { sheet: "Data" }, range: "A1:A100001" },
      { op: "merge_cells", target: { sheet: "Missing" }, range: "A1:B2" },
      { op: "merge_cells", target: { sheet: "Data" } },
    ];
    for (const operation of cases) {
      expect(() => modelWith([operation]), JSON.stringify(operation)).toThrowError(XlsxOpError);
    }
    expect(modelWith([]).pendingStructuralOps()).toEqual([]);
  });
});

describe.skipIf(!existsSync(ARTIFACT))("xlsx merge ops on the real gateway", () => {
  it("merge then unmerge round-trips through one file (two-save chain)", async () => {
    const engine = await load();
    const first = await savedWith(engine, COMPAT_EDIT, [
      { op: "merge_cells", target: { sheet: "Data" }, range: "A1:B2" },
      { op: "merge_cells", target: { sheet: "Data" }, range: "C1:D1" },
    ]);
    let xml = await sheetXml(engine, first.bytes);
    expect(xml).toContain('<mergeCells count="2">');
    expect(xml).toContain('<mergeCell ref="A1:B2"/>');
    expect(xml).toContain('<mergeCell ref="C1:D1"/>');
    // A merged file still opens: the produced bytes are re-parsed on save.
    expect(cells((await engine.readWorkbook(first.bytes)).snapshot, "Data").A1?.value).toBe("Hạng mục");

    const second = await saveOps(engine, first.bytes, [
      { op: "unmerge_cells", target: { sheet: "Data" }, range: "A1:B2" },
    ]);
    xml = await sheetXml(engine, second.bytes);
    expect(xml).not.toContain('ref="A1:B2"');
    expect(xml).toContain('<mergeCells count="1">');
    expect(xml).toContain('<mergeCell ref="C1:D1"/>');
  });

  it("merge across lands one merge per row of the selection", async () => {
    const engine = await load();
    // What the toolbar's "merge across" produces: one op per row — the first
    // spelled as the 0-based bounds form, the rest as A1 ranges.
    const saved = await savedWith(engine, COMPAT_EDIT, [
      { op: "merge_cells", target: { sheet: "Data" }, range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 } },
      { op: "merge_cells", target: { sheet: "Data" }, range: "A2:C2" },
      { op: "merge_cells", target: { sheet: "Data" }, range: "A3:C3" },
    ]);
    const xml = await sheetXml(engine, saved.bytes);
    expect(xml).toContain('<mergeCells count="3">');
    expect(xml).toContain('<mergeCell ref="A1:C1"/>');
    expect(xml).toContain('<mergeCell ref="A2:C2"/>');
    expect(xml).toContain('<mergeCell ref="A3:C3"/>');
  });

  it("shifts a merged range when a later insert moves the sheet, with formula caches kept", async () => {
    const engine = await load();
    const recalc = recordingRecalc();
    const saved = await savedWith(engine, KITCHEN_SINK, [
      { op: "merge_cells", target: { sheet: "Data" }, range: "A1:B2" },
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ], recalc);
    expect(recalc.calls).toBe(0);
    expect(saved.warnings).toContainEqual(expect.objectContaining({ code: "structure_formula_cache_kept" }));
    const xml = await sheetXml(engine, saved.bytes);
    expect(xml).toContain('<mergeCell ref="A2:B3"/>');
    // The inserted row moved the value the merge covers one row down.
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").B2?.value).toBe("Quý I");
  });

  it("writes a cell edit under a merge in the same envelope", async () => {
    const engine = await load();
    const saved = await savedWith(engine, COMPAT_EDIT, [
      { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 42 } },
      { op: "merge_cells", target: { sheet: "Data" }, range: "B2:C3" },
    ]);
    const xml = await sheetXml(engine, saved.bytes);
    expect(xml).toContain('<mergeCell ref="B2:C3"/>');
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").B2?.value).toBe(42);
  });

  it("refuses a single-cell merge before any byte is assembled", async () => {
    const engine = await load();
    await expect(
      saveOps(engine, fixture(COMPAT_EDIT), [
        { op: "merge_cells", target: { sheet: "Data" }, range: "A1:A1" },
      ]),
    ).rejects.toMatchObject({ name: "XlsxOpError" });
  });
});
