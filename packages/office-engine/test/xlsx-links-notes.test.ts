// Hyperlinks + notes (B6) tests. The model/parser half runs anywhere; the
// round-trips run over the REAL patched gateway artifact - the same harness
// xlsx-filter / xlsx-page-setup use. Hyperlinks are a per-cell last-write
// journal applied after structural replay; notes are a declarative whole-sheet
// snapshot the gateway writes after the worksheet flush.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bindXlsxGateway,
  createXlsxAdapter,
  createXlsxSessionModel,
  groupXlsxHyperlinkEdits,
  groupXlsxNoteStates,
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
  const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "links-notes" });
  if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
  adapter.edit(opened.document_model_ref, ops);
  const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
  adapter.release(opened.document_model_ref);
  return { bytes: saved.bytes, warnings: saved.warnings ?? [] };
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

const linkItem = (cell: string, target: string | null, sheet = "Data") => ({
  op: "set_hyperlink",
  target: { sheet },
  attributes: { cell, target },
});
const noteItem = (notes: readonly Record<string, unknown>[], sheet = "Data") => ({
  op: "set_notes",
  target: { sheet },
  attributes: { notes },
});

describe("XLSX hyperlink + note ops in the session model", () => {
  it("folds hyperlink ops per cell, last write wins, in first-touch sheet order", () => {
    const model = modelWith([
      linkItem("A1", "https://example.com"),
      linkItem("A1", "https://example.org"),
      linkItem("B2", "#Data!A1"),
      linkItem("A1", null, "Report"),
    ]);
    expect(model.pendingHyperlinkEdits()).toEqual([
      { sheetName: "Data", edits: [
        { row: 0, column: 0, target: "https://example.org" },
        { row: 1, column: 1, target: "#Data!A1" },
      ] },
      { sheetName: "Report", edits: [{ row: 0, column: 0, target: null }] },
    ]);
    expect(modelWith([]).pendingHyperlinkEdits()).toEqual([]);
  });

  it("folds note snapshots per sheet, last write wins, in first-touch order", () => {
    const model = modelWith([
      noteItem([{ row: 0, column: 0, author: "An", text: "first" }]),
      noteItem([{ row: 1, column: 1, author: "Binh", text: "second" }]),
      noteItem([], "Report"),
    ]);
    expect(model.pendingNoteStates()).toEqual([
      { sheetName: "Data", notes: [{ row: 1, column: 1, author: "Binh", text: "second" }] },
      { sheetName: "Report", notes: [] },
    ]);
  });

  it("moves, drops and clones pending hyperlinks/notes with sheet ops", () => {
    const renamed = modelWith([
      linkItem("A1", "https://example.com"),
      noteItem([{ row: 0, column: 0, author: "An", text: "hi" }]),
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
    ]);
    expect(renamed.pendingHyperlinkEdits()).toEqual([{ sheetName: "Budget", edits: [{ row: 0, column: 0, target: "https://example.com" }] }]);
    expect(renamed.pendingNoteStates()).toEqual([{ sheetName: "Budget", notes: [{ row: 0, column: 0, author: "An", text: "hi" }] }]);
    const removed = modelWith([
      linkItem("A1", "https://example.com"),
      { op: "remove_sheet", target: { sheet: "Data" } },
    ]);
    expect(removed.pendingHyperlinkEdits()).toEqual([]);
    const cloned = modelWith([
      noteItem([{ row: 0, column: 0, author: "An", text: "hi" }]),
      { op: "duplicate_sheet", target: { sheet: "Data" }, attributes: { name: "Data copy" } },
    ]);
    expect(cloned.pendingNoteStates().map((state) => state.sheetName)).toEqual(["Data", "Data copy"]);
  });

  it("groups parsed ops by sheet", () => {
    const sheets = { sheetNames: () => ["Data", "Report"], nameForId: () => undefined };
    const ops = parseXlsxOps([linkItem("A1", "https://a"), noteItem([{ row: 0, column: 0, author: "", text: "n" }])], sheets);
    expect(groupXlsxHyperlinkEdits(ops)).toEqual([{ sheetName: "Data", edits: [{ row: 0, column: 0, target: "https://a" }] }]);
    expect(groupXlsxNoteStates(ops)).toEqual([{ sheetName: "Data", notes: [{ row: 0, column: 0, author: "", text: "n" }] }]);
  });

  it("refuses malformed hyperlink/note snapshots before any op reaches the model", () => {
    const cases: readonly Record<string, unknown>[] = [
      { op: "set_hyperlink", target: { sheet: "Data" } },
      { op: "set_hyperlink", target: { sheet: "Data" }, attributes: { cell: "A1" } },
      { op: "set_hyperlink", target: { sheet: "Data" }, attributes: { cell: "A1", target: "" } },
      { op: "set_hyperlink", target: { sheet: "Data" }, attributes: { cell: "A1", target: "a".repeat(2_084) } },
      { op: "set_hyperlink", target: { sheet: "Data" }, attributes: { cell: "XFE1", target: "https://a" } },
      { op: "set_hyperlink", target: { sheet: "Data" }, attributes: { cell: "A1", target: 7 } },
      { op: "set_hyperlink", target: { sheet: "Missing" }, attributes: { cell: "A1", target: "https://a" } },
      { op: "set_notes", target: { sheet: "Data" } },
      { op: "set_notes", target: { sheet: "Data" }, attributes: {} },
      { op: "set_notes", target: { sheet: "Data" }, attributes: { notes: 1 } },
      noteItem([{ row: -1, column: 0, author: "", text: "x" }]),
      noteItem([{ row: 1_048_576, column: 0, author: "", text: "x" }]),
      noteItem([{ row: 0, column: 16_384, author: "", text: "x" }]),
      noteItem([{ row: 0, column: 0, author: "a".repeat(256), text: "x" }]),
      noteItem([{ row: 0, column: 0, author: "", text: "a".repeat(32_768) }]),
      noteItem([{ row: 0, column: 0, author: "", text: "x" }, { row: 0, column: 0, author: "", text: "y" }]),
      { op: "set_notes", target: { sheet: "Data" }, attributes: { notes: new Array(1_001).fill({ row: 0, column: 0, author: "", text: "x" }) } },
    ];
    for (const operation of cases) {
      expect(() => modelWith([operation]), JSON.stringify(operation).slice(0, 80)).toThrowError(XlsxOpError);
    }
  });

  it("shifts hyperlink and note anchors under row/column structural ops (F3)", () => {
    // Insert a row above: every anchor at/after row 0 moves down one.
    const inserted = modelWith([
      linkItem("A1", "https://example.com"),
      noteItem([{ row: 0, column: 0, author: "An", text: "hi" }]),
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ]);
    expect(inserted.pendingHyperlinkEdits()).toEqual([
      { sheetName: "Data", edits: [{ row: 1, column: 0, target: "https://example.com" }] },
    ]);
    expect(inserted.pendingNoteStates()).toEqual([
      { sheetName: "Data", notes: [{ row: 1, column: 0, author: "An", text: "hi" }] },
    ]);

    // Insert columns: B1 slides to D1, A1 stays put.
    const columns = modelWith([
      linkItem("A1", "https://a"),
      linkItem("B1", "https://b"),
      { op: "insert_cols", target: { sheet: "Data" }, attributes: { index: 1, count: 2 } },
    ]);
    expect(columns.pendingHyperlinkEdits()[0]?.edits).toEqual([
      { row: 0, column: 0, target: "https://a" },
      { row: 0, column: 3, target: "https://b" },
    ]);

    // Remove a row: an anchor inside the removed span drops, one past it slides up.
    const removed = modelWith([
      linkItem("A1", "https://keep"),
      linkItem("A2", "https://drop"),
      noteItem([{ row: 0, column: 0, author: "An", text: "keep" }, { row: 1, column: 0, author: "Binh", text: "drop" }]),
      { op: "remove_rows", target: { sheet: "Data" }, attributes: { index: 1, count: 1 } },
    ]);
    expect(removed.pendingHyperlinkEdits()).toEqual([
      { sheetName: "Data", edits: [{ row: 0, column: 0, target: "https://keep" }] },
    ]);
    expect(removed.pendingNoteStates()).toEqual([
      { sheetName: "Data", notes: [{ row: 0, column: 0, author: "An", text: "keep" }] },
    ]);

    // Remove a column: A1 drops, B1 slides into A1.
    const removedCol = modelWith([
      linkItem("A1", "https://drop"),
      linkItem("B1", "https://slide"),
      { op: "remove_cols", target: { sheet: "Data" }, attributes: { index: 0, count: 1 } },
    ]);
    expect(removedCol.pendingHyperlinkEdits()[0]?.edits).toEqual([{ row: 0, column: 0, target: "https://slide" }]);

    // A structural op on another sheet leaves this sheet's anchors alone.
    const otherSheet = modelWith([
      linkItem("A1", "https://a"),
      { op: "insert_rows", target: { sheet: "Report" }, attributes: { index: 0, count: 3 } },
    ]);
    expect(otherSheet.pendingHyperlinkEdits()).toEqual([
      { sheetName: "Data", edits: [{ row: 0, column: 0, target: "https://a" }] },
    ]);
  });
});

describe.skipIf(!existsSync(ARTIFACT))("xlsx hyperlinks + notes on the real gateway", () => {
  it("writes an external hyperlink and its rels, and the file reopens", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [linkItem("B1", "https://example.com")]);
    const sheetXml = await engine.readEntryText(saved.bytes, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain('<hyperlink ref="B1" r:id=');
    const rels = await engine.readEntryText(saved.bytes, "xl/worksheets/_rels/sheet1.xml.rels");
    expect(rels).toContain("https://example.com");
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(reopened.snapshot.sheets[0]?.name).toBe("Data");
  });

  it("writes an internal anchor without a rel and removes a link with null", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [linkItem("A1", "#Data!B2")]);
    const sheetXml = await engine.readEntryText(saved.bytes, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain('<hyperlink ref="A1" location="Data!B2"/>');
    const cleared = await saveOps(engine, saved.bytes, [linkItem("A1", null)]);
    const clearedXml = await engine.readEntryText(cleared.bytes, "xl/worksheets/sheet1.xml");
    expect(clearedXml).not.toContain("<hyperlinks>");
  });

  it("writes a note set (comments + VML + legacyDrawing) and the file reopens", async () => {
    const engine = await load();
    const saved = await saveOps(engine, fixture(COMPAT_EDIT), [
      noteItem([{ row: 0, column: 1, author: "An", text: "Xem lai so lieu" }]),
    ]);
    const comments = await engine.readEntryText(saved.bytes, "xl/comments1.xml");
    expect(comments).toContain("<author>An</author>");
    expect(comments).toContain("Xem lai so lieu");
    const sheetXml = await engine.readEntryText(saved.bytes, "xl/worksheets/sheet1.xml");
    expect(sheetXml).toContain("<legacyDrawing");
    const reopened = await engine.readWorkbook(saved.bytes);
    expect(reopened.snapshot.sheets[0]?.name).toBe("Data");
  });

  it("removes every note with an empty snapshot (two-save chain)", async () => {
    const engine = await load();
    const set = await saveOps(engine, fixture(COMPAT_EDIT), [noteItem([{ row: 0, column: 0, author: "An", text: "x" }])]);
    expect(await engine.readEntryText(set.bytes, "xl/comments1.xml")).not.toBeNull();
    const cleared = await saveOps(engine, set.bytes, [noteItem([])]);
    expect(await engine.readEntryText(cleared.bytes, "xl/comments1.xml")).toBeNull();
  });
});
