// Sheet operations (B3): add / rename / remove / duplicate / reorder / hide.
// The ordering rule is the core of this file: sheet ops apply in emission
// order (a rename renames the live resolver, an addition/removal changes the
// live sheet set, a reorder changes the tab order), the model keeps pending
// cell/structural edits in the SAME final name space, and the adapter rebuilds
// ONE gateway SheetEditPlan from that state at save time — translating every
// edit name back to the name the package on disk still holds (the gateway
// applies the plan's renames last; cell edits resolve parts by current file
// names, which is why the envelope's final names cannot go to the gateway
// verbatim). The model/parser half runs anywhere; the round-trips run over the
// REAL patched gateway artifact, the same harness xlsx-structural.test.ts and
// xlsx-merge.test.ts use.
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
  type XlsxEditOp,
  type XlsxRecalcPort,
  type XlsxSheetResolver,
  type XlsxWorkbookSnapshot,
} from "../src/xlsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const ARTIFACT = join(REPO, ".go-tmp", "office-upstream-build", "dist", "xlsx-gateway.mjs");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");
const COMPAT_EDIT = "xlsx-compatibility-edit.xlsx";
const COMPAT_STRUCTURE = "xlsx-compatibility-structure.xlsx";
const KITCHEN_SINK = "xlsx-kitchen-sink.xlsx";

type Gateway = Awaited<ReturnType<typeof load>>;
const load = async () => {
  const mod = await import(pathToFileURL(ARTIFACT).href);
  return bindXlsxGateway(mod as never);
};

const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

const baseSnapshot = (): XlsxWorkbookSnapshot => ({
  revision: 0,
  sheets: [
    { id: "sheet-1", name: "Data", cells: { A1: { value: 2 } } },
    { id: "sheet-2", name: "PhuLuc", cells: { B2: { value: 5, formula: "=SUM(Data!B2:B4)" } } },
  ],
});

function modelWith(operations: unknown[]) {
  const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
  parseXlsxOps(operations, model.resolver({ "sheet-1": "Data", "sheet-2": "PhuLuc" }), (op) =>
    model.applyEdit(op),
  );
  return model;
}

/** Parse one envelope against a live resolver exactly like the adapter does. */
function applyEnvelope(model: ReturnType<typeof createXlsxSessionModel>, operations: unknown[]): void {
  const resolver: XlsxSheetResolver = model.resolver({ "sheet-1": "Data", "sheet-2": "PhuLuc" });
  parseXlsxOps(operations, resolver, (op) => model.applyEdit(op));
}

async function saveOps(
  engine: Gateway,
  source: Uint8Array,
  ops: readonly Record<string, unknown>[],
  recalc?: XlsxRecalcPort,
) {
  const adapter = createXlsxAdapter(recalc === undefined ? { engine } : { engine, recalc });
  const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "sheets" });
  if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
  adapter.edit(opened.document_model_ref, ops);
  const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
  adapter.release(opened.document_model_ref);
  return { bytes: saved.bytes, warnings: (saved.warnings ?? []) as { code: string; detail: string }[] };
}

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

const sheetNames = (snapshot: XlsxWorkbookSnapshot) => snapshot.sheets.map((sheet) => sheet.name);

describe("XLSX sheet ops in the session model", () => {
  it("applies all six op kinds in emission order and rebuilds one final plan", () => {
    const model = modelWith([
      { op: "rename_sheet", target: { sheet: "PhuLuc" }, attributes: { newName: "Phụ lục" } },
      { op: "add_sheet", attributes: { name: "Bảng", index: 0 } },
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } },
      { op: "set_sheet_hidden", target: { sheet: "Data copy" }, attributes: { hidden: true } },
      { op: "reorder_sheet", target: { sheet: "Bảng" }, attributes: { index: 2 } },
    ]);
    expect(model.resolver({}).sheetNames()).toEqual(["Data", "Phụ lục", "Bảng", "Data copy"]);
    expect(model.pendingSheetPlan()).toEqual({
      renames: [{ sheetName: "PhuLuc", newName: "Phụ lục" }],
      additions: [
        { name: "Bảng" },
        { name: "Data copy", sourceSheetName: "Data" },
      ],
      removals: [],
      order: ["Data", "Phụ lục", "Bảng", "Data copy"],
      hiddenChanges: [{ sheetName: "Data copy", hidden: true }],
      orderChanged: true,
    });
  });

  it("resolves ops after a rename against the new name and refuses the old one", () => {
    const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
    applyEnvelope(model, [
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
      { op: "set_cell", target: { sheet: "Budget", cell: "B2" }, attributes: { value: 42 } },
      { op: "insert_rows", target: { sheet: "Budget" }, attributes: { index: 0, count: 1 } },
    ]);
    // The shift moved the edit one row down; both carry the final name.
    expect(model.pendingEdits()).toEqual([
      { sheetName: "Budget", row: 2, column: 1, writeValue: true, cell: { value: 42 } },
    ]);
    expect(model.pendingStructuralOps()).toEqual([
      { sheetName: "Budget", ops: [{ kind: "insert-rows", index: 0, count: 1 }] },
    ]);
    expect(model.gatewaySheetName("Budget")).toBe("Data");
    // The old name is gone the moment the rename applies.
    expect(() =>
      applyEnvelope(model, [{ op: "set_cell", target: { sheet: "Data", cell: "C3" }, attributes: { value: 1 } }]),
    ).toThrowError(XlsxOpError);
  });

  it("cancels a same-name re-add and restores the removed sheet's pending state", () => {
    const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
    applyEnvelope(model, [
      { op: "set_cell", target: { sheet: "PhuLuc", cell: "C3" }, attributes: { value: "gone" } },
      { op: "merge_cells", target: { sheet: "PhuLuc" }, range: "A1:B2" },
      { op: "remove_sheet", target: { sheet: "PhuLuc" } },
      { op: "add_sheet", attributes: { name: "PhuLuc" } },
    ]);
    // F3 (c33874e8): the add_sheet matches the removal's tombstone, so it
    // CANCELS the removal (the undo-of-remove replay Univer sends) and
    // resurrects the original state with its pending edits, so the save keeps
    // the file's original part instead of writing a blank one.
    expect(model.pendingEdits()).toEqual([
      { sheetName: "PhuLuc", row: 2, column: 2, writeValue: true, cell: { value: "gone" } },
    ]);
    expect(model.pendingStructuralOps()).toEqual([
      { sheetName: "PhuLuc", ops: [{ kind: "merge-cells", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } }] },
    ]);
    // The plan folds to undefined: the file already holds this state, so the
    // save is a pure cell/structural edit and emits no sheet op.
    expect(model.pendingSheetPlan()).toBeUndefined();
  });

  it("clones a duplicated sheet's pending edits and resolves a copy chain to the file original", () => {
    const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
    applyEnvelope(model, [
      { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 7 } },
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } },
      { op: "duplicate_sheet", target: { sheet: "Data copy" }, attributes: { name: "Data copy 2" } },
    ]);
    expect(model.pendingEdits()).toEqual([
      { sheetName: "Data", row: 1, column: 1, writeValue: true, cell: { value: 7 } },
      { sheetName: "Data copy", row: 1, column: 1, writeValue: true, cell: { value: 7 } },
      { sheetName: "Data copy 2", row: 1, column: 1, writeValue: true, cell: { value: 7 } },
    ]);
    expect(model.pendingSheetPlan()?.additions).toEqual([
      { name: "Data copy", sourceSheetName: "Data" },
      { name: "Data copy 2", sourceSheetName: "Data" },
    ]);
  });

  it("keeps a duplicate of a removed file sheet pointing at that original part", () => {
    const model = modelWith([
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } },
      { op: "remove_sheet", target: { sheet: "Data" } },
    ]);
    expect(model.gatewaySheetName("Data copy")).toBe("Data copy");
    expect(model.pendingSheetPlan()).toMatchObject({
      removals: ["Data"],
      additions: [{ name: "Data copy", sourceSheetName: "Data" }],
      order: ["PhuLuc", "Data copy"],
    });
  });

  it("refuses malformed sheet ops before any op reaches the model", () => {
    const cases: readonly Record<string, unknown>[] = [
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "" } },
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "x".repeat(32) } },
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "a/b" } },
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "'quoted'" } },
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "PhuLuc" } },
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "phuluc" } },
      { op: "rename_sheet", target: { sheet: "Missing" }, attributes: { newName: "Other" } },
      { op: "add_sheet", attributes: { name: "Data" } },
      { op: "add_sheet", attributes: { name: "New", index: 5 } },
      { op: "add_sheet", target: { sheet: "Data" }, attributes: { name: "New" } },
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "PhuLuc" } },
      { op: "reorder_sheet", target: { sheet: "Data" }, attributes: { index: 2 } },
      { op: "reorder_sheet", target: { sheet: "Data" }, attributes: { index: -1 } },
      { op: "reorder_sheet", target: { sheet: "Data" } },
      { op: "set_sheet_hidden", target: { sheet: "Data" }, attributes: { hidden: 1 } },
    ];
    for (const operation of cases) {
      expect(() => modelWith([operation]), JSON.stringify(operation)).toThrowError(XlsxOpError);
    }
    // Removing the last remaining sheet is refused (the gateway would too).
    const single = createXlsxSessionModel({ revision: 0, sheets: [{ id: "sheet-1", name: "Data", cells: {} }] }, "sha");
    expect(() => parseXlsxOps([{ op: "remove_sheet", target: { sheet: "Data" } }], single.resolver({}))).toThrowError(XlsxOpError);
    // Renaming a sheet to its own name (case-only rewrite) is a legal no-op:
    // it applies no sheet op, so the plan folds to undefined (F3, c33874e8).
    const model = modelWith([
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Data" } },
    ]);
    expect(model.pendingSheetPlan()).toBeUndefined();
  });
});

describe.skipIf(!existsSync(ARTIFACT))("xlsx sheet ops on the real gateway", () => {
  it("renames a sheet and writes a cell into it in one envelope, rewriting cross-sheet refs", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_STRUCTURE), [
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
      { op: "set_cell", target: { sheet: "Budget", cell: "D10" }, attributes: { value: 42 } },
    ]);
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(sheetNames(reopened.snapshot)).toEqual(["Budget", "PhuLuc"]);
    expect(reopened.snapshot.sheets[0]?.cells.D10?.value).toBe(42);
    // The rename rewrote the other sheet's qualified reference.
    const sheet2 = await engine.readEntryText(saved.bytes, "xl/worksheets/sheet2.xml");
    expect(sheet2).toContain("Budget!B2:B4");
    expect(sheet2).not.toContain("Data!B2:B4");
  });

  it("adds a sheet, writes into it and reorders it in one envelope", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [
      { op: "add_sheet", attributes: { name: "Scratch", index: 0 } },
      { op: "set_cell", target: { sheet: "Scratch", cell: "A1" }, attributes: { value: "hello" } },
      { op: "reorder_sheet", target: { sheet: "Scratch" }, attributes: { index: 1 } },
    ]);
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(sheetNames(reopened.snapshot)).toEqual(["Data", "Scratch"]);
    expect(reopened.snapshot.sheets[1]?.cells.A1?.value).toBe("hello");
  });

  it("duplicates a sheet with a session edit without losing the source content", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_STRUCTURE), [
      { op: "set_cell", target: { sheet: "Data", cell: "D10" }, attributes: { value: 7 } },
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } },
    ]);
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(sheetNames(reopened.snapshot)).toEqual(["Data", "PhuLuc", "Data copy"]);
    const source = reopened.snapshot.sheets[0];
    const copy = reopened.snapshot.sheets[2];
    // The clone carries the file content AND the journaled edit.
    expect(copy?.cells.A1?.value).toBe(source?.cells.A1?.value);
    expect(copy?.cells.D10?.value).toBe(7);
    expect(source?.cells.D10?.value).toBe(7);
  });

  it("hides and unhides a sheet through two saves", async () => {
    const engine = await load();
    // A hidden-only plan keeps sheet identity, so the recalc pass still runs
    // (the workbook carries formulas); only identity-changing plans skip it.
    const recalc = recordingRecalc();
    const hidden = await saveOps(engine, fixture(COMPAT_STRUCTURE), [
      { op: "set_sheet_hidden", target: { sheet: "PhuLuc" }, attributes: { hidden: true } },
    ], recalc);
    expect(recalc.calls).toBeGreaterThan(0);
    expect(hidden.warnings.some((warning) => warning.code === "sheet_formula_cache_kept")).toBe(false);
    const workbookXml = await engine.readEntryText(hidden.bytes, "xl/workbook.xml");
    expect(workbookXml).toContain('state="hidden"');
    const shown = await saveOps(engine, hidden.bytes, [
      { op: "set_sheet_hidden", target: { sheet: "PhuLuc" }, attributes: { hidden: false } },
    ], recordingRecalc());
    expect(await engine.readEntryText(shown.bytes, "xl/workbook.xml")).not.toContain('state="hidden"');
  });

  it("removes a sheet added in an earlier save (two-save chain)", async () => {
    const engine = await load();
    const added = await saveOps(engine, fixture(COMPAT_EDIT), [
      { op: "add_sheet", attributes: { name: "Scratch" } },
      { op: "set_cell", target: { sheet: "Scratch", cell: "A1" }, attributes: { value: "x" } },
    ]);
    const removed = await saveOps(engine, added.bytes, [
      { op: "remove_sheet", target: { sheet: "Scratch" } },
    ]);
    expect(sheetNames((await engine.readWorkbook(removed.bytes)).snapshot)).toEqual(["Data"]);
  });

  it("fails closed when a removed sheet is still referenced", async () => {
    const engine = await load();
    await expect(
      saveOps(engine, fixture(COMPAT_STRUCTURE), [
        { op: "remove_sheet", target: { sheet: "Data" } },
      ]),
    ).rejects.toMatchObject({
      code: "engine_result_invalid",
      fields: { detail: expect.stringMatching(/referenc/i) },
    });
  });

  it("skips native recalc for an identity-changing sheet plan and says so", async () => {
    const engine = await load();
    const recalc = recordingRecalc();
    const saved = await saveOps(engine, fixture(KITCHEN_SINK), [
      { op: "rename_sheet", target: { sheet: "PhuLuc" }, attributes: { newName: "Phụ lục" } },
      { op: "set_cell", target: { sheet: "Phụ lục", cell: "C10" }, attributes: { value: 1 } },
    ], recalc);
    expect(recalc.calls).toBe(0);
    expect(saved.warnings).toContainEqual(expect.objectContaining({ code: "sheet_formula_cache_kept" }));
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(sheetNames(reopened.snapshot)).toEqual(["Data", "Phụ lục"]);
    expect(reopened.snapshot.sheets[1]?.cells.C10?.value).toBe(1);
  });
});

describe("XLSX sheet-op envelope fold", () => {
  it("keeps parse and apply interleaved so a later op sees the earlier rename", () => {
    const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
    const seen: XlsxEditOp[] = [];
    parseXlsxOps(
      [
        { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
        { op: "set_cell", target: { sheet: "Budget", cell: "A1" }, attributes: { value: 1 } },
      ],
      model.resolver({}),
      (op) => {
        seen.push(op);
        model.applyEdit(op);
      },
    );
    expect(seen.map((op) => op.kind)).toEqual(["rename_sheet", "set_cell"]);
    expect(model.pendingEdits()[0]?.sheetName).toBe("Budget");
  });
});
