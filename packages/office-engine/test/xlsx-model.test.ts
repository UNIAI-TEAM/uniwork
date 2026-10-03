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
});
