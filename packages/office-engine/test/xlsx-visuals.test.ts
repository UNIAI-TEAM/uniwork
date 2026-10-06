// Visuals (B8, UNI-940 X02) tests. The parser/model half runs anywhere; the
// round-trip runs over the REAL patched gateway artifact (patch 0010 binds
// visualAdditions on applyCellEditsToXlsx), the harness xlsx-tables and
// xlsx-recalc-after-assemble use. A visual is NEW package parts written on
// save: xl/drawings/drawingN.xml (+ rels), xl/charts/chartN.xml for a chart,
// xl/media/imageN.* for a picture, and the worksheet <drawing> element.
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
  type XlsxRecalcEdit,
  type XlsxRecalcPort,
  type XlsxRecalcRead,
  type XlsxWorkbookSnapshot,
} from "../src/xlsx";
import { a1ToRowColumn } from "../src/xlsx/ops-shared";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const ARTIFACT = join(REPO, ".go-tmp", "office-upstream-build", "dist", "xlsx-gateway.mjs");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");
const COMPAT_EDIT = "xlsx-compatibility-edit.xlsx";

// A 1x1 transparent PNG.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const anchor = (fromRow = 1, fromColumn = 1, toRow = 6, toColumn = 5) => ({
  fromRow, fromColumn, fromRowOffset: 0, fromColumnOffset: 0, toRow, toColumn, toRowOffset: 0, toColumnOffset: 0,
});
const chart = {
  chartType: "column",
  title: "Sales",
  series: [{ name: "Q1", categories: ["North", "South"], values: [10, 20], valuesRef: "'Data'!$B$2:$B$3", categoriesRef: "'Data'!$A$2:$A$3" }],
};
const setVisual = (id: string, body: Record<string, unknown>, sheet = "Data", at = anchor()) => ({
  op: "set_visual", target: { sheet }, attributes: { id, anchor: at, ...body },
});
const removeVisual = (id: string, sheet = "Data") => ({ op: "remove_visual", target: { sheet }, attributes: { id } });

const baseSnapshot = (): XlsxWorkbookSnapshot => ({
  revision: 0,
  sheets: [
    { id: "sheet-1", name: "Data", cells: { A1: { value: "Region" }, B1: { value: "Q1" } } },
    { id: "sheet-2", name: "Report", cells: {} },
  ],
});
const sheets = { sheetNames: () => ["Data", "Report"], nameForId: () => undefined };

function modelWith(operations: unknown[]) {
  const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
  parseXlsxOps(operations, model.resolver({ "sheet-1": "Data", "sheet-2": "Report" }), (op) => model.applyEdit(op));
  return model;
}

function parseError(item: unknown): XlsxOpError {
  try {
    parseXlsxOps([item], sheets);
  } catch (error) {
    if (error instanceof XlsxOpError) return error;
    throw error;
  }
  throw new Error("expected a parse error");
}

describe("XLSX visual ops: wire parser", () => {
  it("parses a chart, a shape and a picture into typed set_visual ops", () => {
    const ops = parseXlsxOps([
      setVisual("c1", { chart }),
      setVisual("s1", { shape: { shapeType: "ellipse", fillColor: "#4472C4", text: "Hi" } }),
      setVisual("p1", { image: { mediaType: "image/png", base64: PNG_BASE64 } }),
    ], sheets);
    expect(ops.map((op) => op.kind)).toEqual(["set_visual", "set_visual", "set_visual"]);
    expect(ops[0]).toMatchObject({ sheetName: "Data", id: "c1", anchor: anchor(), chart: { chartType: "column", title: "Sales" } });
    expect(ops[1]).toMatchObject({ shape: { shapeType: "ellipse", fillColor: "#4472C4", text: "Hi" } });
    expect(ops[2]).toMatchObject({ image: { mediaType: "image/png" } });
  });

  it("refuses a visual with no body or two bodies", () => {
    expect(parseError(setVisual("x", {})).field).toBe("attributes");
    expect(parseError(setVisual("x", { chart, shape: { shapeType: "rect" } })).field).toBe("attributes");
  });

  it("refuses a reversed or empty anchor and unknown anchor keys", () => {
    expect(parseError(setVisual("x", { chart }, "Data", anchor(5, 5, 2, 2))).field).toBe("attributes.anchor");
    expect(parseError(setVisual("x", { chart }, "Data", anchor(3, 3, 3, 3))).field).toBe("attributes.anchor");
    const extra = { ...anchor(), rotation: 90 };
    expect(parseError(setVisual("x", { chart }, "Data", extra as never)).field).toBe("attributes.anchor.rotation");
  });

  it("bounds chart types, series and values", () => {
    expect(parseError(setVisual("x", { chart: { ...chart, chartType: "radar" } })).field).toBe("attributes.chart.chartType");
    expect(parseError(setVisual("x", { chart: { ...chart, series: [] } })).field).toBe("attributes.chart.series");
    const nan = { ...chart, series: [{ name: "a", categories: [], values: [Number.NaN] }] };
    expect(parseError(setVisual("x", { chart: nan })).field).toBe("attributes.chart.series[0].values");
  });

  it("checks shape presets, colours, picture types and the picture size cap", () => {
    expect(parseError(setVisual("x", { shape: { shapeType: "star99" } })).field).toBe("attributes.shape.shapeType");
    expect(parseError(setVisual("x", { shape: { shapeType: "rect", fillColor: "red" } })).field).toBe("attributes.shape.fillColor");
    expect(parseError(setVisual("x", { image: { mediaType: "image/bmp", base64: PNG_BASE64 } })).field).toBe("attributes.image.mediaType");
    expect(parseError(setVisual("x", { image: { mediaType: "image/png", base64: "not base64!" } })).field).toBe("attributes.image.base64");
    const huge = parseError(setVisual("x", { image: { mediaType: "image/png", base64: "A".repeat(700_000) } }));
    expect(huge.field).toBe("attributes.image.base64");
    expect(huge.unsupported).toBe(true);
  });

  it("refuses a malformed id and unknown attributes", () => {
    expect(parseError(setVisual("bad id", { chart })).field).toBe("attributes.id");
    expect(parseError(removeVisual("")).field).toBe("attributes.id");
    expect(parseError({ ...removeVisual("a"), attributes: { id: "a", force: true } }).field).toBe("attributes.force");
  });
});

describe("XLSX visual ops in the session model", () => {
  it("keeps first-insert order, replaces a moved visual in place and drops a removed one", () => {
    const moved = anchor(10, 10, 12, 14);
    const model = modelWith([
      setVisual("c1", { chart }),
      setVisual("s1", { shape: { shapeType: "rect" } }),
      setVisual("c1", { chart }, "Data", moved),
      setVisual("p1", { image: { mediaType: "image/png", base64: PNG_BASE64 } }),
      removeVisual("s1"),
    ]);
    const additions = model.pendingVisualAdditions();
    expect(additions.map((visual) => (visual.chart ? "chart" : visual.shape ? "shape" : "image"))).toEqual(["chart", "image"]);
    expect(additions[0]?.anchor).toEqual(moved);
    expect(model.isDirty).toBe(true);
  });

  it("follows a sheet rename, drops with a removed sheet and comes back with its undo", () => {
    const renamed = modelWith([
      setVisual("c1", { chart }),
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Budget" } },
    ]);
    expect(renamed.pendingVisualAdditions().map((visual) => visual.sheetName)).toEqual(["Budget"]);

    const removed = modelWith([
      setVisual("c1", { chart }, "Report"),
      { op: "remove_sheet", target: { sheet: "Report" } },
    ]);
    expect(removed.pendingVisualAdditions()).toEqual([]);

    const restored = modelWith([
      setVisual("c1", { chart }, "Report"),
      { op: "remove_sheet", target: { sheet: "Report" } },
      { op: "add_sheet", attributes: { name: "Report" } },
    ]);
    expect(restored.pendingVisualAdditions().map((visual) => visual.sheetName)).toEqual(["Report"]);
  });

  it("rolls back with a checkpoint and drains on rebase", () => {
    const model = modelWith([setVisual("c1", { chart })]);
    const checkpoint = model.checkpoint();
    model.applyEdit(parseXlsxOps([removeVisual("c1")], sheets)[0]!);
    expect(model.pendingVisualAdditions()).toEqual([]);
    model.rollback(checkpoint);
    expect(model.pendingVisualAdditions()).toHaveLength(1);
    model.rebase(baseSnapshot(), "sha-next");
    expect(model.pendingVisualAdditions()).toEqual([]);
  });
});

// ── real gateway round-trip ────────────────────────────────────────────────

type Gateway = Awaited<ReturnType<typeof load>>;
const load = async () => {
  const mod = await import(pathToFileURL(ARTIFACT).href);
  return bindXlsxGateway(mod as never);
};
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** Answers every formula cell the bytes hold, plus every formula the edits
 *  type, with a value derived from its coordinate, so a cached <v> read back
 *  provably came from this recalc. */
function answeringRecalc(engine: Gateway): XlsxRecalcPort {
  return {
    async recalc(bytes: Uint8Array, edits: readonly XlsxRecalcEdit[], reads: readonly XlsxRecalcRead[]) {
      const { snapshot } = await engine.readWorkbook(bytes);
      const cells = [];
      for (const read of reads) {
        const sheet = snapshot.sheets.find((candidate) => candidate.name === read.sheet);
        const formulas = Object.entries(sheet?.cells ?? {})
          .filter(([, cell]) => cell.formula !== undefined)
          .map(([address]) => a1ToRowColumn(address, "<test>", "address"))
          .concat(edits.filter((edit) => edit.sheet === read.sheet && edit.input.startsWith("=")));
        for (const { row, column } of formulas) {
          const inside = row >= read.range.startRow && row <= read.range.endRow && column >= read.range.startColumn && column <= read.range.endColumn;
          if (!inside) continue;
          const value = 1000 * row + column + 0.5;
          cells.push({ sheet: read.sheet, row, column, formatted: String(value), number: value, isError: false, isFormula: true });
        }
      }
      return { cells, cached: false };
    },
    async close() {},
  };
}

describe.skipIf(!existsSync(ARTIFACT))("xlsx visuals over the real gateway artifact", () => {
  it("writes chart, picture and shape parts a re-read of the saved bytes finds", async () => {
    const engine = await load();
    const source = fixture(COMPAT_EDIT);
    const adapter = createXlsxAdapter({ engine });
    const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "visuals" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    const sheet = (await engine.readWorkbook(source)).snapshot.sheets[0]!.name;
    adapter.edit(opened.document_model_ref, [
      setVisual("c1", { chart }, sheet),
      setVisual("p1", { image: { mediaType: "image/png", base64: PNG_BASE64 } }, sheet, anchor(8, 1, 12, 3)),
      setVisual("s1", { shape: { shapeType: "rightArrow", fillColor: "#ED7D31" } }, sheet, anchor(8, 4, 10, 7)),
      setVisual("s2", { shape: { shapeType: "ellipse" } }, sheet, anchor(14, 1, 16, 3)),
      removeVisual("s2", sheet),
    ]);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    adapter.release(opened.document_model_ref);

    const paths = (await engine.inventory(saved.bytes)).map((entry) => entry.path);
    expect(paths.some((path) => /^xl\/drawings\/drawing\d+\.xml$/.test(path))).toBe(true);
    expect(paths.some((path) => /^xl\/charts\/chart\d+\.xml$/.test(path))).toBe(true);
    expect(paths.some((path) => /^xl\/media\/image\d+\.png$/.test(path))).toBe(true);
    const drawingPath = paths.find((path) => /^xl\/drawings\/drawing\d+\.xml$/.test(path))!;
    const chartPath = paths.find((path) => /^xl\/charts\/chart\d+\.xml$/.test(path))!;
    const parts = await engine.readEntriesText(saved.bytes, [drawingPath, chartPath, "[Content_Types].xml"]);
    const drawing = parts[drawingPath] ?? "";
    expect(drawing.match(/<xdr:twoCellAnchor/g)).toHaveLength(3);
    expect(drawing).toContain('prst="rightArrow"');
    expect(drawing).not.toContain('prst="ellipse"');
    expect(parts[chartPath]).toContain("<c:barChart>");
    expect(parts[chartPath]).toContain("'Data'!$B$2:$B$3");
    expect(parts["[Content_Types].xml"]).toContain("drawingml.chart+xml");

    // The saved package re-opens through the engine like any other file.
    const reopened = await createXlsxAdapter({ engine }).open({ bytes: saved.bytes, format: "xlsx", document_id: "visuals-2" });
    expect(reopened.outcome).toBe("opened");
  });

  it("keeps formulas and refreshes their cached values in a save that also carries a chart", async () => {
    const engine = await load();
    const source = fixture(COMPAT_EDIT);
    const adapter = createXlsxAdapter({ engine, recalc: answeringRecalc(engine) });
    const opened = await adapter.open({ bytes: source, format: "xlsx", document_id: "visuals-formula" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    const sheet = (await engine.readWorkbook(source)).snapshot.sheets[0]!.name;
    adapter.edit(opened.document_model_ref, [
      { op: "set_cell", target: { sheet, cell: "A41" }, text: "=1+1" },
      setVisual("c1", { chart }, sheet),
    ]);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    adapter.release(opened.document_model_ref);

    const reread = (await engine.readWorkbook(saved.bytes)).snapshot.sheets.find((candidate) => candidate.name === sheet)!;
    expect(reread.cells.A41?.formula).toBe("=1+1");
    // The basic snapshot does not read a formula cell's cache; the part does.
    const worksheet = await engine.readEntryText(saved.bytes, "xl/worksheets/sheet1.xml");
    expect(worksheet).toMatch(/<c r="A41"[^>]*><f>1\+1<\/f><v>40000\.5<\/v><\/c>/);
    const paths = (await engine.inventory(saved.bytes)).map((entry) => entry.path);
    expect(paths.some((path) => /^xl\/charts\/chart\d+\.xml$/.test(path))).toBe(true);
  });
});
