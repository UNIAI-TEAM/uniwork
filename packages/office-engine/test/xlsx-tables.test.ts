// Tables (B9) tests. The model/parser half runs anywhere; the round-trip runs
// over the REAL patched gateway artifact - the same harness xlsx-filter /
// xlsx-page-setup use. A table is a NEW workbook part written on save
// (xl/tables/tableN.xml, the worksheet <tableParts> element and its
// relationship); remove_table only cancels a session add.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bindXlsxGateway,
  createXlsxAdapter,
  createXlsxSessionModel,
  groupXlsxTableAdditions,
  isXlsxTableAddOp,
  isXlsxTableRemoveOp,
  parseXlsxOps,
  XlsxOpError,
  type XlsxWorkbookSnapshot,
} from "../src/xlsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const ARTIFACT = join(REPO, ".go-tmp", "office-upstream-build", "dist", "xlsx-gateway.mjs");
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
  const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "tables" });
  if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
  adapter.edit(opened.document_model_ref, ops);
  const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
  adapter.release(opened.document_model_ref);
  return { bytes: saved.bytes, warnings: saved.warnings ?? [] };
}

const baseSnapshot = (): XlsxWorkbookSnapshot => ({
  revision: 0,
  sheets: [
    { id: "sheet-1", name: "Data", cells: { A1: { value: "Region" }, B1: { value: "Q1" }, A2: { value: "North" }, B2: { value: 10 } } },
    { id: "sheet-2", name: "Report", cells: {} },
  ],
});

function modelWith(operations: unknown[]) {
  const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
  for (const op of parseXlsxOps(operations, model.resolver({ "sheet-1": "Data", "sheet-2": "Report" }))) model.applyEdit(op);
  return model;
}

const item = (attributes: Record<string, unknown>, range: unknown, sheet = "Data") => ({ op: "create_table", target: { sheet }, range, attributes });

describe("XLSX table ops in the session model", () => {
  it("keeps table additions in emission order and folds remove_table by name", () => {
    const model = modelWith([
      item({ name: "Sales", columnNames: ["Region", "Q1"] }, "A1:B5"),
      item({ name: "Costs", columnNames: ["Region", "Q1"] }, "A1:B5"),
      { op: "remove_table", target: { sheet: "Data" }, attributes: { name: "sales" } },
    ]);
    expect(model.pendingTableAdditions().map((table) => table.name)).toEqual(["Costs"]);
    expect(modelWith([]).pendingTableAdditions()).toEqual([]);
  });

  it("defaults bandedRows to true and refuses total rows / header-less tables as unsupported", () => {
    const [op] = parseXlsxOps([item({ name: "T", columnNames: ["a", "b"] }, "A1:B2")], {
      sheetNames: () => ["Data"],
      nameForId: () => undefined,
    });
    if (!op || !isXlsxTableAddOp(op)) throw new Error("expected a table op");
    expect(op.bandedRows).toBe(true);
    expect(op.style).toBeUndefined();
    const unsupported = [
      item({ name: "T", columnNames: ["a", "b"], totalRow: true }, "A1:B2"),
      item({ name: "T", columnNames: ["a", "b"], headerRow: false }, "A1:B2"),
    ];
    for (const operation of unsupported) {
      try {
        parseXlsxOps([operation], { sheetNames: () => ["Data"], nameForId: () => undefined });
        throw new Error("expected an unsupported refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(XlsxOpError);
        expect((error as XlsxOpError).unsupported).toBe(true);
      }
    }
  });

  it("groups and cancels table ops (pure fold)", () => {
    const sheets = { sheetNames: () => ["Data"], nameForId: () => undefined };
    const ops = parseXlsxOps([
      item({ name: "T", columnNames: ["a", "b"] }, "A1:B2"),
      { op: "remove_table", target: { sheet: "Data" }, attributes: { name: "T" } },
      item({ name: "U", columnNames: ["a", "b"] }, "A1:B2"),
    ], sheets);
    expect(groupXlsxTableAdditions(ops).map((table) => table.name)).toEqual(["U"]);
    expect(ops.filter(isXlsxTableRemoveOp)).toHaveLength(1);
  });

  it("moves and drops pending tables with sheet ops", () => {
    const renamed = modelWith([
      item({ name: "T", columnNames: ["a", "b"] }, "A1:B2"),
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
    ]);
    expect(renamed.pendingTableAdditions()).toEqual([
      expect.objectContaining({ sheetName: "Budget", name: "T" }),
    ]);
    const removed = modelWith([
      item({ name: "T", columnNames: ["a", "b"] }, "A1:B2"),
      { op: "remove_sheet", target: { sheet: "Data" } },
    ]);
    expect(removed.pendingTableAdditions()).toEqual([]);
  });

  it("refuses malformed table ops before any op reaches the model", () => {
    const cases: readonly Record<string, unknown>[] = [
      { op: "create_table", target: { sheet: "Data" }, attributes: { name: "T", columnNames: ["a"] } },
      item({ name: "T", columnNames: ["a"] }, "A1:A1"),
      item({ name: "1T", columnNames: ["a", "b"] }, "A1:B2"),
      item({ name: "A1", columnNames: ["a", "b"] }, "A1:B2"),
      item({ name: "T", columnNames: ["a", " "] }, "A1:B2"),
      item({ name: "T", columnNames: ["a", "A"] }, "A1:B2"),
      item({ name: "T", columnNames: ["a", "b"] }, "A1:C2"),
      item({ name: "T", columnNames: ["a", "b"], style: "Fancy" }, "A1:B2"),
      item({ name: "T", columnNames: ["a", "b"], bandedRows: 1 }, "A1:B2"),
      item({ name: "T", columnNames: ["a", "b"], foo: 1 }, "A1:B2"),
      item({ name: "T", columnNames: ["a", "b"] }, "B2:A1"),
      item({ name: "T", columnNames: ["a", "b"] }, "A1:B2", "Missing"),
      { op: "remove_table", target: { sheet: "Data" }, attributes: {} },
    ];
    for (const operation of cases) {
      expect(() => modelWith([operation]), JSON.stringify(operation)).toThrowError(XlsxOpError);
    }
  });
});

describe.skipIf(!existsSync(ARTIFACT))("xlsx tables on the real gateway", () => {
  it("writes a table part, worksheet tableParts and the relationship, and the file reopens", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [
      item({ name: "Sales", columnNames: ["Region", "Q1"], style: "TableStyleMedium2", bandedRows: true }, "A1:B3"),
    ]);
    const tableXml = await engine.readEntryText(saved.bytes, "xl/tables/table1.xml");
    expect(tableXml).not.toBeNull();
    expect(tableXml).toContain('name="Sales"');
    expect(tableXml).toContain('ref="A1:B3"');
    expect(tableXml).toContain('name="TableStyleMedium2"');
    expect(tableXml).toContain('showRowStripes="1"');
    expect(tableXml).toContain('name="Region"');
    const sheetXml = await engine.readEntryText(saved.bytes, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain("<tableParts");
    const entries = await engine.inventory(saved.bytes);
    expect(entries.some((entry) => entry.path === "xl/tables/table1.xml")).toBe(true);
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(reopened.snapshot.sheets[0]?.name).toBe("Data");
  });

  it("persists a table alongside cell edits in one envelope", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [
      { op: "set_cell", target: { sheet: "Data", cell: "D1" }, attributes: { value: "Hoa don" } },
      item({ name: "T2", columnNames: ["Region", "Q1"] }, "A1:B3"),
    ]);
    expect(await engine.readEntryText(saved.bytes, "xl/tables/table1.xml")).toContain('name="T2"');
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(reopened.snapshot.sheets[0]?.cells.D1?.value).toBe("Hoa don");
  });
});
