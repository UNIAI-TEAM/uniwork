// Filter (B4) tests. The model/parser half runs anywhere; the round-trips run
// over the REAL patched gateway artifact — the same harness xlsx-structural /
// xlsx-merge use. A filter is a declarative whole-sheet snapshot: the model
// folds last-write-per-sheet, and the gateway applies the final state after
// structural replay and cell edits, so reopen shows the autoFilter and the
// hidden rows the snapshot carried.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bindXlsxGateway,
  createXlsxAdapter,
  createXlsxSessionModel,
  groupXlsxFilterStates,
  parseXlsxOps,
  XlsxOpError,
  type XlsxWorkbookSnapshot,
} from "../src/xlsx";
import { ARTIFACT, describeWithPatchedGateway } from "./xlsx-patched-gateway";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");
const COMPAT_EDIT = "xlsx-compatibility-edit.xlsx";

type Gateway = Awaited<ReturnType<typeof load>>;
const load = async () => {
  const mod = await import(pathToFileURL(ARTIFACT).href);
  return bindXlsxGateway(mod as never);
};

const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

async function saveOps(engine: Gateway, source: Uint8Array, ops: readonly Record<string, unknown>[]) {
  const adapter = createXlsxAdapter({ engine });
  const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "filter" });
  if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
  adapter.edit(opened.document_model_ref, ops);
  const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
  adapter.release(opened.document_model_ref);
  return { bytes: saved.bytes, warnings: saved.warnings ?? [] };
}

const savedWith = (engine: Gateway, name: string, ops: readonly Record<string, unknown>[]) =>
  saveOps(engine, fixture(name), ops);

const cells = (snapshot: XlsxWorkbookSnapshot, sheetName: string) =>
  snapshot.sheets.find((sheet) => sheet.name === sheetName)?.cells ?? {};

async function sheetXml(engine: Gateway, bytes: Uint8Array): Promise<string> {
  const xml = await engine.readEntryText(bytes, "xl/worksheets/sheet1.xml");
  if (xml === null) throw new Error("sheet1 part missing");
  return xml;
}

const rowXml = (xml: string, rowNumber: number): string =>
  new RegExp(`<row r="${rowNumber}"[^>]*>`).exec(xml)?.[0] ?? "";

const range = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 };

const setFilterItem = (columns: readonly Record<string, unknown>[], hiddenRows: readonly number[]) => ({
  op: "set_filter",
  target: { sheet: "Data" },
  attributes: { filter: { range, columns }, hiddenRows, visibilityRange: range },
});

const clearFilterItem = { op: "clear_filter", target: { sheet: "Data" }, attributes: { visibilityRange: range } };

const baseSnapshot = (): XlsxWorkbookSnapshot => ({
  revision: 0,
  sheets: [
    { id: "sheet-1", name: "Data", cells: { A1: { value: 2 } } },
    { id: "sheet-2", name: "Report", cells: {} },
  ],
});

function modelWith(operations: unknown[]) {
  const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
  for (const op of parseXlsxOps(operations, model.resolver({ "sheet-1": "Data", "sheet-2": "Report" }))) model.applyEdit(op);
  return model;
}

describe("XLSX filter ops in the session model", () => {
  it("folds filter ops per sheet, last write wins, and folds a clear to filter null", () => {
    const model = modelWith([
      setFilterItem([{ colId: 0, values: ["x"] }], [2]),
      clearFilterItem,
      setFilterItem([{ colId: 1, blank: true }], [1]),
    ]);
    expect(model.pendingFilterStates()).toEqual([
      { sheetName: "Data", filter: { range, columns: [{ colId: 1, blank: true }] }, hiddenRows: [1], visibilityRange: range },
    ]);
    const cleared = modelWith([
      setFilterItem([{ colId: 0, values: ["x"] }], [2]),
      clearFilterItem,
    ]);
    expect(cleared.pendingFilterStates()).toEqual([
      { sheetName: "Data", filter: null, hiddenRows: [], visibilityRange: range },
    ]);
    expect(modelWith([]).pendingFilterStates()).toEqual([]);
  });

  it("moves, drops and clones pending filter state with sheet ops", () => {
    const renamed = modelWith([
      setFilterItem([{ colId: 0, values: ["x"] }], [2]),
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
    ]);
    expect(renamed.pendingFilterStates()).toEqual([
      { sheetName: "Budget", filter: { range, columns: [{ colId: 0, values: ["x"] }] }, hiddenRows: [2], visibilityRange: range },
    ]);
    const removed = modelWith([
      setFilterItem([{ colId: 0, values: ["x"] }], [2]),
      { op: "remove_sheet", target: { sheet: "Data" } },
    ]);
    expect(removed.pendingFilterStates()).toEqual([]);
    const cloned = modelWith([
      setFilterItem([{ colId: 0, values: ["x"] }], [2]),
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } },
    ]);
    expect(cloned.pendingFilterStates().map((state) => state.sheetName)).toEqual(["Data", "Data copy"]);
  });

  it("groups parsed filter ops by sheet with the clear conversion", () => {
    const sheets = { sheetNames: () => ["Data", "Report"], nameForId: () => undefined };
    const ops = parseXlsxOps([
      setFilterItem([{ colId: 0, values: ["x"] }], [2]),
      setFilterItem([{ colId: 1, blank: true }], []),
      { op: "clear_filter", target: { sheet: "Report" }, attributes: { visibilityRange: range } },
    ], sheets);
    expect(groupXlsxFilterStates(ops)).toEqual([
      { sheetName: "Data", filter: { range, columns: [{ colId: 1, blank: true }] }, hiddenRows: [], visibilityRange: range },
      { sheetName: "Report", filter: null, hiddenRows: [], visibilityRange: range },
    ]);
  });

  it("refuses malformed filter snapshots before any op reaches the model", () => {
    const cases: readonly Record<string, unknown>[] = [
      { op: "set_filter", target: { sheet: "Data" } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range: { ...range, endRow: 0 }, columns: [] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range: { ...range, startColumn: 2, endColumn: 1 }, columns: [] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [{ colId: 2, blank: true }] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [{ colId: 0.5, blank: true }] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [{ colId: 0 }] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [{ colId: 0, values: ["x"] }, { colId: 0, blank: true }] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [{ colId: 0, values: [7] }] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [{ colId: 0, customs: { filters: [] } }] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [{ colId: 0, customs: { filters: [{ val: "a" }, { val: "b" }, { val: "c" }] } }] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [{ colId: 0, customs: { filters: [{ val: "a", operator: "contains" }] } }] }, hiddenRows: [], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [] }, hiddenRows: [-1], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [] }, hiddenRows: [1.5], visibilityRange: range } },
      { op: "set_filter", target: { sheet: "Data" }, attributes: { filter: { range, columns: [] }, hiddenRows: [], visibilityRange: { ...range, startRow: 3, endRow: 0 } } },
      { op: "set_filter", target: { sheet: "Missing" }, attributes: { filter: { range, columns: [] }, hiddenRows: [], visibilityRange: range } },
      { op: "clear_filter", target: { sheet: "Data" } },
      { op: "clear_filter", target: { sheet: "Data" }, attributes: { visibilityRange: { ...range, endColumn: 16_384 } } },
    ];
    for (const operation of cases) {
      expect(() => modelWith([operation]), JSON.stringify(operation)).toThrowError(XlsxOpError);
    }
  });
});

describeWithPatchedGateway("xlsx filter ops on the real gateway", () => {
  it("set_filter writes the autoFilter and hidden rows, and the file reopens", async () => {
    const engine = await load();
    const saved = await savedWith(engine, COMPAT_EDIT, [
      {
        op: "set_filter",
        target: { sheet: "Data" },
        attributes: {
          filter: {
            range: { startRow: 0, endRow: 5, startColumn: 0, endColumn: 1 },
            columns: [
              { colId: 0, values: ["Doanh thu"] },
              { colId: 1, customs: { filters: [{ val: 780_000_000, operator: "greaterThan" }] } },
            ],
          },
          hiddenRows: [1, 3],
          visibilityRange: { startRow: 0, endRow: 5, startColumn: 0, endColumn: 1 },
        },
      },
    ]);
    const xml = await sheetXml(engine, saved.bytes);
    expect(xml).toContain('<autoFilter ref="A1:B6">');
    expect(xml).toContain('<filterColumn colId="0"><filters><filter val="Doanh thu"/></filters></filterColumn>');
    expect(xml).toContain('<filterColumn colId="1"><customFilters><customFilter operator="greaterThan" val="780000000"/></customFilters></filterColumn>');
    expect(rowXml(xml, 2)).toContain('hidden="1"');
    expect(rowXml(xml, 4)).toContain('hidden="1"');
    expect(rowXml(xml, 1)).not.toContain('hidden="1"');
    // A filtered file still opens: readWorkbook re-parses the produced bytes.
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").A2?.value).toBe("Doanh thu");
  });

  it("clear_filter removes the autoFilter and unhides its rows (two-save chain)", async () => {
    const engine = await load();
    const filtered = await savedWith(engine, COMPAT_EDIT, [
      setFilterItem([{ colId: 0, values: ["Doanh thu"] }], [1, 3]),
    ]);
    expect(await sheetXml(engine, filtered.bytes)).toContain("<autoFilter");
    const cleared = await saveOps(engine, filtered.bytes, [clearFilterItem]);
    const xml = await sheetXml(engine, cleared.bytes);
    expect(xml).not.toContain("<autoFilter");
    expect(rowXml(xml, 2)).not.toContain('hidden="1"');
    expect(rowXml(xml, 4)).not.toContain('hidden="1"');
  });

  it("applies cell edits before the filter snapshot in one envelope", async () => {
    const engine = await load();
    const saved = await savedWith(engine, COMPAT_EDIT, [
      { op: "set_cell", target: { sheet: "Data", cell: "B1" }, attributes: { value: "Quý III" } },
      setFilterItem([{ colId: 0, values: ["Doanh thu"] }], [3]),
    ]);
    const xml = await sheetXml(engine, saved.bytes);
    expect(xml).toContain("<autoFilter");
    expect(rowXml(xml, 4)).toContain('hidden="1"');
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(cells(reopened.snapshot, "Data").B1?.value).toBe("Quý III");
  });
});
