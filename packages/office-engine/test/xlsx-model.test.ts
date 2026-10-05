import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bindXlsxGateway, createXlsxAdapter, createXlsxSessionModel, parseXlsxOps, readXlsxRenderModel, type XlsxWorkbookSnapshot } from "../src/xlsx";
import { createFakeRecalc, createFakeXlsxEngine, makeFakeXlsxBytes } from "./fake-xlsx-engine";

const snapshot = (): XlsxWorkbookSnapshot => ({ revision: 0, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 2 }, B1: { value: 4, formula: "=A1*2" } } }] });
const target = { sheet: "Data", cell: "A1" };
const value = { op: "set_cell", target, attributes: { value: 7 } };
const formula = { op: "set_cell", target, attributes: { formula: "=B1+3" } };
const style = { op: "set_cell", target, style: { bold: true, borderTop: { style: "thin", color: { theme: 2, tint: 0.5 } } } };
function modelWith(operations: unknown[], base = snapshot()) {
  const model = createXlsxSessionModel(base, "sha-base");
  for (const op of parseXlsxOps(operations, model.resolver({ "sheet-1": "Data" }))) model.applyEdit(op);
  return model;
}

describe("XLSX cell edit folding", () => {
  it.each([{ operations: [value, style] }, { operations: [style, value] }])("retains the value and style in either order: $operations", ({ operations }) => {
    const model = modelWith(operations);
    expect(model.cells("Data").A1).toEqual({ value: 7 });
    expect(model.pendingEdits()).toEqual([{ sheetName: "Data", row: 0, column: 0, writeValue: true, cell: { value: 7 }, style: style.style }]);
    expect(model.pendingRecalcEdits()).toEqual([{ sheet: "Data", row: 0, column: 0, input: "7" }]);
  });

  it.each([{ operations: [formula, style] }, { operations: [style, formula] }])("retains the formula and its recalc input in either order: $operations", ({ operations }) => {
    const model = modelWith(operations);
    expect(model.cells("Data").A1).toEqual({ value: null, formula: "=B1+3" });
    expect(model.pendingEdits()[0]).toMatchObject({ writeValue: true, cell: { formula: "=B1+3" }, style: style.style });
    expect(model.pendingRecalcEdits()).toEqual([{ sheet: "Data", row: 0, column: 0, input: "=B1+3" }]);
    expect(model.formulaCellsAfterEdits().map((cell) => cell.address)).toEqual(["A1", "B1"]);
  });

  it("merges independent nested style fields, with complete later fields replacing earlier fields", () => {
    const model = modelWith([style, { op: "set_cell", target, style: { italic: true, borderBottom: { style: "double", color: "#123456" } } }, { op: "set_cell", target, style: { borderTop: { style: "dashed", color: { theme: 4 } } } }]);
    expect(model.pendingEdits()[0]?.style).toEqual({ bold: true, italic: true, borderTop: { style: "dashed", color: { theme: 4 } }, borderBottom: { style: "double", color: "#123456" } });
    expect(model.pendingRecalcEdits()).toEqual([]);
    expect(model.cells("Data").A1).toEqual({ value: 2 });
  });

  it("a style reset discards old style deltas, retaining value and later deltas", () => {
    const model = modelWith([value, style, { op: "set_cell", target, attributes: { styleReset: true }, style: { italic: true } }, { op: "set_cell", target, attributes: { styleReset: false }, style: { wrapText: true } }]);
    expect(model.pendingEdits()[0]).toMatchObject({ cell: { value: 7 }, styleReset: true, style: { italic: true, wrapText: true } });
    expect(model.pendingRecalcEdits()[0]?.input).toBe("7");
  });

  it("clears content while preserving styles and the explicit reset", () => {
    const model = modelWith([formula, { op: "set_cell", target, attributes: { styleReset: true }, style: { bold: true } }, { op: "clear_cell", target }, { op: "set_cell", target, style: { italic: true } }]);
    expect(model.cells("Data").A1).toBeUndefined();
    expect(model.pendingEdits()[0]).toMatchObject({ writeValue: true, cell: { value: null }, styleReset: true, style: { bold: true, italic: true } });
    expect(model.pendingRecalcEdits()[0]?.input).toBe("");
    expect(model.formulaCellsAfterEdits().map((cell) => cell.address)).toEqual(["B1"]);
  });

  it("keeps sheet/address pairs distinct even when concatenated text collides", () => {
    const base: XlsxWorkbookSnapshot = { revision: 0, sheets: [{ id: "one", name: "Data", cells: {} }, { id: "two", name: "DataA", cells: {} }] };
    const model = modelWith([{ op: "set_cell", target: { sheet: "Data", cell: "AA1" }, attributes: { value: 1 } }, { op: "set_cell", target: { sheet: "DataA", cell: "A1" }, attributes: { value: 2 } }], base);
    expect(model.pendingEdits()).toHaveLength(2);
    expect(model.cells("Data").AA1?.value).toBe(1);
    expect(model.cells("DataA").A1?.value).toBe(2);
  });

  it("owns nested style deltas rather than retaining caller references", () => {
    const op = structuredClone(style);
    const model = modelWith([op]);
    op.style.borderTop.color.theme = 9;
    expect(model.pendingEdits()[0]?.style).toEqual(style.style);
  });

  it("resolves sheet-id edits and never resurrects a formula overwritten before styling", () => {
    const target = { sheetId: "sheet-1", cell: "B1" };
    const model = modelWith([{ op: "set_cell", target, attributes: { value: 6 } }, { op: "set_cell", target, style: { italic: true } }]);
    expect(model.cells("Data").B1).toEqual({ value: 6 });
    expect(model.coveredFormulaCount()).toBe(0);
    expect(model.pendingRecalcEdits()).toEqual([{ sheet: "Data", row: 0, column: 1, input: "6" }]);
  });

  it("counts shared-formula followers as formula cells unless a pending edit wrote their content (R3-1B)", () => {
    const base: XlsxWorkbookSnapshot = {
      revision: 0,
      sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 2 }, B1: { value: 4, formula: "=A1*2" }, B2: { value: 4 }, B3: { value: 4 }, B4: { value: 4 } } }],
    };
    const followers = new Map([["Data", new Set(["B2", "B3", "B4"])]]);
    const model = modelWith(
      [
        { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 9 } },
        { op: "set_cell", target: { sheet: "Data", cell: "B3" }, style: { bold: true } },
      ],
      base,
    );
    // B2: a literal typed over the follower; B3: style-only keeps the formula.
    expect(model.formulaCellsAfterEdits(followers).map((cell) => cell.address).sort()).toEqual(["B1", "B3", "B4"]);
    expect(model.formulaCellsAfterEdits().map((cell) => cell.address)).toEqual(["B1"]);
  });

  it("refuses reading an unknown sheet without losing the current pending plan", () => {
    const model = modelWith([value, style]);
    expect(() => model.cells("missing")).toThrow("unknown sheet");
    expect(model.cells("Data").A1?.value).toBe(7);
    expect(model.isDirty).toBe(true);
  });

  it.each([{ operations: [value, style] }, { operations: [style, value] }, { operations: [formula, style] }, { operations: [style, formula] }])("preserves content through native-port serialization and a fresh reopen: $operations", async ({ operations }) => {
    const engine = createFakeXlsxEngine();
    const recalc = createFakeRecalc();
    const nativeApply = engine.applyCellEdits.bind(engine);
    let appliedStyle: unknown;
    engine.applyCellEdits = async (bytes, edits, values) => {
      appliedStyle = edits[0]?.style;
      return nativeApply(bytes, edits, values);
    };
    const adapter = createXlsxAdapter({ engine, recalc });
    const opened = await adapter.open({ bytes: makeFakeXlsxBytes({ sheets: snapshot().sheets.map((sheet) => ({ name: sheet.name, cells: { ...sheet.cells } })) }), format: "xlsx", document_id: "doc" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    adapter.edit(opened.document_model_ref, operations);
    const output = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    const reopened = await engine.readWorkbook(output.bytes);
    expect(appliedStyle).toEqual(style.style);
    const hasFormula = operations.some((operation) => operation === formula);
    expect(reopened.snapshot.sheets[0]?.cells.A1).toMatchObject(hasFormula ? { formula: "=B1+3" } : { value: 7 });
    expect(recalc.calls[0]?.edits[0]?.input).toBe(hasFormula ? "=B1+3" : "7");
    expect(adapter.isDirty(opened.document_model_ref)).toBe(false);
  });
});

describe("XLSX structural journal", () => {
  it("moves pending cell edits into the op's post-operation coordinates", () => {
    const model = modelWith([
      value, // A1 (row 0)
      { op: "set_cell", target: { sheet: "Data", cell: "A3" }, attributes: { value: 9 } }, // row 2
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 2 } },
    ]);
    expect(model.pendingEdits()).toEqual([
      expect.objectContaining({ row: 2, column: 0, cell: { value: 7 } }),
      expect.objectContaining({ row: 4, column: 0, cell: { value: 9 } }),
    ]);
    expect(model.pendingRecalcEdits()).toEqual([
      { sheet: "Data", row: 2, column: 0, input: "7" },
      { sheet: "Data", row: 4, column: 0, input: "9" },
    ]);
    // The snapshot itself stays the parse of the original bytes.
    expect(model.cells("Data").A1).toEqual({ value: 2 });
  });

  it("drops pending edits a removal deletes and shifts the survivors", () => {
    const model = modelWith([
      { op: "set_cell", target: { sheet: "Data", cell: "A2" }, attributes: { value: 1 } }, // row 1, deleted
      { op: "set_cell", target: { sheet: "Data", cell: "A4" }, attributes: { value: 2 } }, // row 3
      { op: "remove_rows", target: { sheet: "Data" }, attributes: { index: 1, count: 2 } },
    ]);
    expect(model.pendingEdits()).toEqual([expect.objectContaining({ row: 1, column: 0, cell: { value: 2 } })]);
  });

  it("shifts columns on column ops and leaves cells alone on attribute ops", () => {
    const model = modelWith([
      { op: "set_cell", target: { sheet: "Data", cell: "B1" }, attributes: { value: 5 } },
      { op: "insert_cols", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
      { op: "set_row_size", target: { sheet: "Data" }, attributes: { start: 0, end: 0, size: 30 } },
      { op: "set_cols_hidden", target: { sheet: "Data" }, attributes: { start: 0, end: 0, hidden: true } },
      { op: "set_rows_outline", target: { sheet: "Data" }, attributes: { start: 2, end: 2, level: 1 } },
    ]);
    expect(model.pendingEdits()).toEqual([expect.objectContaining({ row: 0, column: 2, cell: { value: 5 } })]);
    expect(model.pendingStructuralOps()).toEqual([
      {
        sheetName: "Data",
        ops: [
          { kind: "insert-cols", index: 0, count: 1 },
          { kind: "set-row-size", start: 0, end: 0, size: 30 },
          { kind: "set-cols-hidden", start: 0, end: 0, hidden: true },
          { kind: "set-rows-outline", start: 2, end: 2, level: 1 },
        ],
      },
    ]);
  });

  it("groups per sheet in journal order and drains the journal on rebase", () => {
    const base: XlsxWorkbookSnapshot = { revision: 0, sheets: [{ id: "one", name: "Data", cells: {} }, { id: "two", name: "Report", cells: {} }] };
    const model = modelWith([
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
      { op: "set_col_size", target: { sheet: "Report" }, attributes: { start: 0, end: 2, size: null } },
      { op: "remove_cols", target: { sheet: "Data" }, attributes: { index: 1, count: 1 } },
    ], base);
    expect(model.pendingStructuralOps()).toEqual([
      { sheetName: "Data", ops: [{ kind: "insert-rows", index: 0, count: 1 }, { kind: "remove-cols", index: 1, count: 1 }] },
      { sheetName: "Report", ops: [{ kind: "set-col-size", start: 0, end: 2, size: null }] },
    ]);
    expect(model.isDirty).toBe(true);
    model.rebase(base, "sha-next");
    expect(model.pendingStructuralOps()).toEqual([]);
    expect(model.isDirty).toBe(false);
  });

  it("drives the gateway structuralOps slot and recalcs only the produced bytes", async () => {
    const engine = createFakeXlsxEngine();
    const recalc = createFakeRecalc();
    const gatewayArguments: unknown[] = [];
    const nativeApply = engine.applyCellEdits.bind(engine);
    engine.applyCellEdits = async (bytes, edits, values, args) => {
      gatewayArguments.push(args);
      return nativeApply(bytes, edits, values);
    };
    const adapter = createXlsxAdapter({ engine, recalc });
    const opened = await adapter.open({ bytes: makeFakeXlsxBytes({ sheets: snapshot().sheets.map((sheet) => ({ name: sheet.name, cells: { ...sheet.cells } })) }), format: "xlsx", document_id: "structural" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    adapter.edit(opened.document_model_ref, [{ op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } }]);
    await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    // Pass 1 carries the structural ops; pass 2 only writes recalculated <v>s.
    expect(gatewayArguments[0]).toEqual({ structuralOps: [{ sheetName: "Data", ops: [{ kind: "insert-rows", index: 0, count: 1 }] }] });
    expect(gatewayArguments.slice(1)).toEqual([undefined]);
    // B1's formula lives on the shifted sheet: no recalc may replay edits
    // against the original bytes' coordinates - the only recalc reads the
    // produced package with zero edits (R3-1).
    expect(recalc.calls.length).toBeGreaterThan(0);
    expect(recalc.calls.every((call) => call.edits.length === 0)).toBe(true);
  });
});

describe("XLSX table journal drain (FIX-B9-1)", () => {
  it("clears the table journal in rebase alongside the other journals", () => {
    const model = createXlsxSessionModel(snapshot(), "sha-base");
    for (const op of parseXlsxOps([
      { op: "create_table", target: { sheet: "Data" }, range: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }, attributes: { name: "Sales", columnNames: ["Region", "Q1"] } },
    ], model.resolver({ "sheet-1": "Data" }))) model.applyEdit(op);
    expect(model.pendingTableAdditions().map((table) => table.name)).toEqual(["Sales"]);
    model.rebase(snapshot(), "sha-next");
    expect(model.pendingTableAdditions()).toEqual([]);
    expect(model.isDirty).toBe(false);
  });

  it("drains pending table additions so a second save succeeds and carries no stale table ops", async () => {
    const engine = createFakeXlsxEngine();
    const recalc = createFakeRecalc();
    const gatewayArguments: unknown[] = [];
    const nativeApply = engine.applyCellEdits.bind(engine);
    engine.applyCellEdits = async (bytes, edits, values, args) => {
      gatewayArguments.push(args);
      return nativeApply(bytes, edits, values);
    };
    const adapter = createXlsxAdapter({ engine, recalc });
    const opened = await adapter.open({
      bytes: makeFakeXlsxBytes({ sheets: [{ name: "Data", cells: { A1: { value: "Region" }, B1: { value: "Q1" }, A2: { value: "North" }, B2: { value: 10 } } }] }),
      format: "xlsx",
      document_id: "table-drain",
    });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    adapter.edit(opened.document_model_ref, [
      { op: "create_table", target: { sheet: "Data" }, range: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }, attributes: { name: "Sales", columnNames: ["Region", "Q1"] } },
    ]);
    await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    expect(gatewayArguments[0]).toEqual({
      tableAdditions: [{ sheetName: "Data", area: { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }, name: "Sales", columnNames: ["Region", "Q1"], bandedRows: true }],
    });
    // The rebase drained the table journal, so the second save with no new ops
    // succeeds and passes no stale tableAdditions to the gateway (the real
    // gateway throws TableAddError on the duplicate name).
    await expect(adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" })).resolves.toBeDefined();
    expect(gatewayArguments[1]).toBeUndefined();
  });
});

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const artifact = join(repo, ".go-tmp", "office-upstream-build", "dist", "xlsx-gateway.mjs");
describe.skipIf(!existsSync(artifact))("XLSX real gateway cell folding", () => {
  it.each(["value_then_style", "style_then_value"])("persists value and OOXML style through fresh reopen: %s", async (order) => {
    const module = await import(pathToFileURL(artifact).href);
    const engine = bindXlsxGateway(module as never);
    const adapter = createXlsxAdapter({ engine });
    const opened = await adapter.open({ bytes: new Uint8Array(readFileSync(join(repo, "docs", "office", "g0", "fixtures", "files", "sheets", "xlsx-compatibility-edit.xlsx"))), format: "xlsx", document_id: "real-folding" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    const target = { sheet: adapter.sheetNames(opened.document_model_ref)[0]!, cell: "B2" };
    const value = { op: "set_cell", target, attributes: { value: 42 } };
    const style = { op: "set_cell", target, attributes: { styleReset: true }, style: { bold: true, fontSize: 27, fillColor: "#12ABCD", numberFormat: "0.00" } };
    adapter.edit(opened.document_model_ref, order === "value_then_style" ? [value, style] : [style, value]);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    const fresh = createXlsxAdapter({ engine });
    const reopened = await fresh.open({ bytes: saved.bytes, format: "xlsx", document_id: "reopened" });
    if (reopened.outcome !== "opened") throw new Error("reopen_failed");
    expect(fresh.snapshotOf(reopened.document_model_ref).sheets[0]?.cells.B2?.value).toBe(42);
    const render = await readXlsxRenderModel(engine, saved.bytes);
    const styleIndex = render.sheets[0]?.cells.B2?.s;
    expect(styleIndex).toBeTypeOf("number");
    expect(render.styles[styleIndex!]).toMatchObject(style.style);
    adapter.release(opened.document_model_ref);
    fresh.release(reopened.document_model_ref);
  });
  it("persists a value plus the currency preset format through a fresh reopen", async () => {
    // Demo step 1: edit a cell value, apply number format (currency), save, reopen.
    // The existing case above covers a plain "0.00" code; this pins the catalog's
    // real currency pattern (a quoted VND sign) through the OOXML numFmt round trip.
    const module = await import(pathToFileURL(artifact).href);
    const engine = bindXlsxGateway(module as never);
    const adapter = createXlsxAdapter({ engine });
    const opened = await adapter.open({ bytes: new Uint8Array(readFileSync(join(repo, "docs", "office", "g0", "fixtures", "files", "sheets", "xlsx-compatibility-edit.xlsx"))), format: "xlsx", document_id: "real-currency" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    const target = { sheet: adapter.sheetNames(opened.document_model_ref)[0]!, cell: "D4" };
    const currency = '#,##0"\u20ab"';
    adapter.edit(opened.document_model_ref, [
      { op: "set_cell", target, attributes: { value: 1250000 } },
      { op: "set_cell", target, attributes: { styleReset: true }, style: { numberFormat: currency } },
    ]);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    const fresh = createXlsxAdapter({ engine });
    const reopened = await fresh.open({ bytes: saved.bytes, format: "xlsx", document_id: "reopened-currency" });
    if (reopened.outcome !== "opened") throw new Error("reopen_failed");
    expect(fresh.snapshotOf(reopened.document_model_ref).sheets[0]?.cells.D4?.value).toBe(1250000);
    const render = await readXlsxRenderModel(engine, saved.bytes);
    const styleIndex = render.sheets[0]?.cells.D4?.s;
    expect(styleIndex).toBeTypeOf("number");
    expect(render.styles[styleIndex!]?.numberFormat).toBe(currency);
    adapter.release(opened.document_model_ref);
    fresh.release(reopened.document_model_ref);
  });
});
