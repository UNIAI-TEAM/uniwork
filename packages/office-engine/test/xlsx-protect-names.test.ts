// Protection + defined names (B7) tests. The model/parser half runs anywhere;
// the round-trips run over the REAL patched gateway artifact - the same
// harness xlsx-filter / xlsx-page-setup use. A protection flag is a
// whole-sheet declarative state the model folds last-write-per-sheet; the
// defined-names snapshot is workbook-scoped (the last op wins) and the
// gateway rewrites workbook.xml's <definedNames> from it.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bindXlsxGateway,
  createXlsxAdapter,
  createXlsxSessionModel,
  groupXlsxDefinedNamesState,
  groupXlsxSheetProtectionStates,
  parseXlsxOps,
  XlsxOpError,
  type XlsxWorkbookSnapshot,
  type XlsxEditOp,
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
  const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "protect-names" });
  if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
  adapter.edit(opened.document_model_ref, ops);
  const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
  adapter.release(opened.document_model_ref);
  return { bytes: saved.bytes, warnings: saved.warnings ?? [] };
}

async function entry(engine: Gateway, bytes: Uint8Array, path: string): Promise<string> {
  const xml = await engine.readEntryText(bytes, path);
  if (xml === null) throw new Error("part missing: " + path);
  return xml;
}

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

const sheets = { sheetNames: () => ["Data", "Report"], nameForId: () => undefined };
const protection = (protectedFlag: boolean, sheet = "Data") => ({ op: "set_sheet_protection", target: { sheet }, attributes: { protected: protectedFlag } });
const names = (list: readonly unknown[], preserveNames: readonly string[] = []) => ({ op: "set_defined_names", attributes: { names: list, preserveNames } });

describe("XLSX protection + defined names in the session model", () => {
  it("folds protection per sheet, last write wins, first-touch order", () => {
    const model = modelWith([
      protection(true),
      protection(false, "Report"),
      protection(true),
    ]);
    expect(model.pendingSheetProtectionStates()).toEqual([
      { sheetName: "Data", protected: true },
      { sheetName: "Report", protected: false },
    ]);
    expect(modelWith([]).pendingSheetProtectionStates()).toEqual([]);
  });

  it("keeps the last defined-names snapshot and folds it as workbook state", () => {
    const model = modelWith([
      names([{ name: "First", formula: "Sheet1!$A$1" }]),
      names([{ name: "Second", formula: "Sheet1!$B$1" }]),
    ]);
    expect(model.pendingDefinedNamesState()).toEqual({
      names: [{ name: "Second", formula: "Sheet1!$B$1" }],
      preserveNames: [],
    });
    expect(modelWith([]).pendingDefinedNamesState()).toBeUndefined();
  });

  it("moves, drops and clones pending protection with sheet ops", () => {
    const renamed = modelWith([protection(true), { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } }]);
    expect(renamed.pendingSheetProtectionStates()).toEqual([{ sheetName: "Budget", protected: true }]);
    const removed = modelWith([protection(true), { op: "remove_sheet", target: { sheet: "Data" } }]);
    expect(removed.pendingSheetProtectionStates()).toEqual([]);
    const cloned = modelWith([protection(true), { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } }]);
    expect(cloned.pendingSheetProtectionStates().map((state) => state.sheetName)).toEqual(["Data", "Data copy"]);
  });

  it("groups parsed ops by sheet, last write wins", () => {
    const ops = parseXlsxOps([protection(true), protection(false), protection(true, "Report")], sheets);
    expect(groupXlsxSheetProtectionStates(ops)).toEqual([
      { sheetName: "Data", protected: false },
      { sheetName: "Report", protected: true },
    ]);
    const namesOps: XlsxEditOp[] = parseXlsxOps([names([{ name: "N", formula: "A1" }])], sheets);
    expect(groupXlsxDefinedNamesState(namesOps)).toEqual({ names: [{ name: "N", formula: "A1" }], preserveNames: [] });
  });

  it("refuses malformed protection and defined-name snapshots", () => {
    const cases: readonly Record<string, unknown>[] = [
      { op: "set_sheet_protection", target: { sheet: "Data" } },
      { op: "set_sheet_protection", target: { sheet: "Data" }, attributes: {} },
      { op: "set_sheet_protection", target: { sheet: "Data" }, attributes: { protected: "yes" } },
      { op: "set_sheet_protection", target: { sheet: "Data" }, attributes: { protected: null } },
      { op: "set_sheet_protection", target: { sheet: "Data" }, attributes: { protected: true, extra: 1 } },
      protection(true, "Missing"),
      { op: "set_defined_names", attributes: {} },
      { op: "set_defined_names", attributes: { names: "N" } },
      { op: "set_defined_names", attributes: { names: [{ name: "A1", formula: "A1" }] } },
      { op: "set_defined_names", attributes: { names: [{ name: "TRUE", formula: "A1" }] } },
      { op: "set_defined_names", attributes: { names: [{ name: "_xlnm.Print_Area", formula: "A1" }] } },
      { op: "set_defined_names", attributes: { names: [{ name: "N", formula: "" }] } },
      { op: "set_defined_names", attributes: { names: [{ name: "N", formula: "A1" }, { name: "N", formula: "A2" }] } },
      { op: "set_defined_names", attributes: { names: [{ name: "N", formula: "A1", sheetIndex: 16384 }] } },
      { op: "set_defined_names", attributes: { names: [], junk: 1 } },
      { op: "set_defined_names", attributes: { names: [{ name: "N", formula: "A1" }], preserveNames: ["N"] } },
    ];
    for (const operation of cases) {
      expect(() => modelWith([operation]), JSON.stringify(operation)).toThrowError(XlsxOpError);
    }
  });
});

describeWithPatchedGateway("xlsx protection + defined names on the real gateway", () => {
  it("writes <sheetProtection> and reopens", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [protection(true)]);
    const sheetXml = await entry(engine, saved.bytes, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain("<sheetProtection");
    expect(sheetXml).toContain('sheet="1"');
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(reopened.snapshot.sheets[0]?.name).toBe("Data");
  });

  it("removes <sheetProtection> when unprotected (two-save chain)", async () => {
    const engine = await load();
    const protectedBytes = await saveOps(engine, fixture(COMPAT_EDIT), [protection(true)]);
    expect(await entry(engine, protectedBytes.bytes, "xl/worksheets/sheet1.xml")).toContain("<sheetProtection");
    const cleared = await saveOps(engine, protectedBytes.bytes, [protection(false)]);
    expect(await entry(engine, cleared.bytes, "xl/worksheets/sheet1.xml")).not.toContain("<sheetProtection");
  });

  it("writes workbook definedNames and reopens", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [
      names([{ name: "SalesTotal", formula: "Sheet1!$A$1:$B$2" }]),
    ]);
    const workbookXml = await entry(engine, saved.bytes, "xl/workbook.xml");
    expect(workbookXml).toContain('name="SalesTotal"');
    expect(workbookXml).toContain("Sheet1!$A$1:$B$2");
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(reopened.snapshot.sheets[0]?.name).toBe("Data");
  });
});
