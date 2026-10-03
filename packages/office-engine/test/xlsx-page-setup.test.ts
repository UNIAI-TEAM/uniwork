// Page setup (C2) tests. The model/parser half runs anywhere; the round-trips
// run over the REAL patched gateway artifact - the same harness xlsx-filter /
// xlsx-structural use. A page-setup snapshot is declarative whole-sheet state:
// the model folds last-write-per-sheet, and the gateway merges each present
// field into the worksheet's printOptions/pageMargins/pageSetup (and the
// sheetView display attributes) and maintains the sheet-scoped
// _xlnm.Print_Area / _xlnm.Print_Titles defined names in workbook.xml.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bindXlsxGateway,
  createXlsxAdapter,
  createXlsxSessionModel,
  groupXlsxPageSetupStates,
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
  const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "page-setup" });
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

const item = (attributes: Record<string, unknown>, sheet = "Data") => ({ op: "set_page_setup", target: { sheet }, attributes });

describe("XLSX page-setup ops in the session model", () => {
  it("folds page-setup ops per sheet, last write wins, in first-touch order", () => {
    const model = modelWith([
      item({ orientation: "portrait" }),
      item({ printArea: "A1:C10" }),
      item({ orientation: "landscape", printTitles: "1:2" }, "Report"),
      item({ scale: 80 }),
    ]);
    // Field-wise last-write-wins: the later op overrides only the fields it
    // carries (a partial snapshot must not drop an earlier dialog apply's
    // settings). First-touch sheet order is kept.
    expect(model.pendingPageSetupStates()).toEqual([
      { sheetName: "Data", orientation: "portrait", printArea: "A1:C10", scale: 80 },
      { sheetName: "Report", orientation: "landscape", printTitles: "1:2" },
    ]);
    expect(modelWith([]).pendingPageSetupStates()).toEqual([]);
  });

  it("moves, drops and clones pending page setup with sheet ops", () => {
    const renamed = modelWith([
      item({ orientation: "landscape" }),
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
    ]);
    expect(renamed.pendingPageSetupStates()).toEqual([{ sheetName: "Budget", orientation: "landscape" }]);
    const removed = modelWith([
      item({ orientation: "landscape" }),
      { op: "remove_sheet", target: { sheet: "Data" } },
    ]);
    expect(removed.pendingPageSetupStates()).toEqual([]);
    const cloned = modelWith([
      item({ orientation: "landscape" }),
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } },
    ]);
    expect(cloned.pendingPageSetupStates().map((state) => state.sheetName)).toEqual(["Data", "Data copy"]);
  });

  it("groups parsed page-setup ops by sheet, last write wins", () => {
    const sheets = { sheetNames: () => ["Data", "Report"], nameForId: () => undefined };
    const ops = parseXlsxOps([
      item({ orientation: "portrait" }),
      item({ paperSize: 9 }),
      item({ margins: "wide" }, "Report"),
    ], sheets);
    expect(groupXlsxPageSetupStates(ops)).toEqual([
      { sheetName: "Data", orientation: "portrait", paperSize: 9 },
      { sheetName: "Report", margins: "wide" },
    ]);
  });

  it("refuses malformed page-setup snapshots before any op reaches the model", () => {
    const cases: readonly Record<string, unknown>[] = [
      { op: "set_page_setup", target: { sheet: "Data" } },
      { op: "set_page_setup", target: { sheet: "Data" }, attributes: {} },
      item({ orientation: "diagonal" }),
      item({ margins: "huge" }),
      item({ paperSize: 0 }),
      item({ paperSize: 119 }),
      item({ paperSize: 9.5 }),
      item({ scale: 9 }),
      item({ scale: 401 }),
      item({ fitToWidth: -1 }),
      item({ fitToHeight: 1_001 }),
      item({ fitToPage: 1 }),
      item({ printGridlines: "yes" }),
      item({ frozenRows: -1 }),
      item({ frozenColumns: 16_384 }),
      item({ printArea: "A1:" }),
      item({ printArea: "A1:XFE1" }),
      item({ printArea: "" }),
      item({ printTitles: "A1:B2" }),
      item({ printTitles: "3:1" }),
      item({ printTitles: "0:5" }),
      item({ printTitles: 3 }),
      item({ rowBreaks: [0] }),
      item({ rowBreaks: [1_048_576] }),
      item({ rowBreaks: 1 }),
      item({ colBreaks: [1.5] }),
      item({ orientation: "portrait", foo: 1 }),
      item({ orientation: "portrait" }, "Missing"),
    ];
    for (const operation of cases) {
      expect(() => modelWith([operation]), JSON.stringify(operation)).toThrowError(XlsxOpError);
    }
  });
});

describe.skipIf(!existsSync(ARTIFACT))("xlsx page setup on the real gateway", () => {
  it("writes orientation, margins, print area/titles and breaks, and the file reopens", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [
      item({
        orientation: "landscape",
        paperSize: 9,
        margins: "narrow",
        printGridlines: true,
        printArea: "A1:C10",
        printTitles: "1:2",
        rowBreaks: [5],
        colBreaks: [2],
      }),
    ]);
    const sheetXml = await entry(engine, saved.bytes, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain('orientation="landscape"');
    expect(sheetXml).toContain('paperSize="9"');
    expect(sheetXml).toContain('<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75"');
    expect(sheetXml).toContain("<printOptions");
    expect(sheetXml).toContain('gridLines="1"');
    expect(sheetXml).toContain('<brk id="5"');
    expect(sheetXml).toContain('<brk id="2"');
    const workbookXml = await entry(engine, saved.bytes, "xl/workbook.xml");
    expect(workbookXml).toContain('name="_xlnm.Print_Area"');
    expect(workbookXml).toContain("$A$1:$C$10");
    expect(workbookXml).toContain('name="_xlnm.Print_Titles"');
    expect(workbookXml).toContain("$1:$2");
    // The saved package re-parses.
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(reopened.snapshot.sheets[0]?.name).toBe("Data");
  });

  it("clears a print area and titles with null (two-save chain)", async () => {
    const engine = await load();
    const set = await saveOps(engine, fixture(COMPAT_EDIT), [
      item({ printArea: "A1:B5", printTitles: "1:1" }),
    ]);
    expect(await entry(engine, set.bytes, "xl/workbook.xml")).toContain("_xlnm.Print_Area");
    const cleared = await saveOps(engine, set.bytes, [item({ printArea: null, printTitles: null })]);
    const workbookXml = await entry(engine, cleared.bytes, "xl/workbook.xml");
    expect(workbookXml).not.toContain("_xlnm.Print_Area");
    expect(workbookXml).not.toContain("_xlnm.Print_Titles");
  });

  it("folds two page-setup ops in one envelope, last write winning", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [
      item({ orientation: "landscape" }),
      item({ orientation: "portrait", scale: 50 }),
    ]);
    const sheetXml = await entry(engine, saved.bytes, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain('orientation="portrait"');
    expect(sheetXml).not.toContain('orientation="landscape"');
    expect(sheetXml).toContain('scale="50"');
  });

  it("keeps untouched print settings verbatim alongside a page-setup edit", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [
      { op: "set_cell", target: { sheet: "Data", cell: "B1" }, attributes: { value: "Hoa don" } },
      item({ orientation: "landscape" }),
    ]);
    const sheetXml = await entry(engine, saved.bytes, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain('orientation="landscape"');
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(reopened.snapshot.sheets[0]?.cells.B1?.value).toBe("Hoa don");
  });
});
