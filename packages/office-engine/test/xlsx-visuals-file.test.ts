// File-native visuals (UNI-953 X02): charts, pictures and shapes ALREADY IN A
// WORKBOOK. The render model lists them per sheet in drawing order
// (render-model-visuals.ts); the editor moves or deletes one with
// set_visual / remove_visual { file: <drawing index> }, which the engine
// folds into the gateway's visualEdits (patch 0013). The round trips run over
// the real patched gateway bundle (describeWithPatchedGateway).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createXlsxAdapter, createXlsxSessionModel, parseXlsxOps, readXlsxRenderModel, XlsxOpError, type XlsxWorkbookSnapshot } from "../src/xlsx";
import { groupXlsxFileVisualEdits, renameXlsxVisualSheet, shiftXlsxVisualAnchor, type XlsxVisualEntry } from "../src/xlsx/ops-visuals";
import { parseChartXml, parseDrawingXml, readDrawingPathsBySheet, readSheetVisuals } from "../src/xlsx/render-model-visuals";
import { describeWithPatchedGateway, loadPatchedGateway } from "./xlsx-patched-gateway";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "xlsx-visuals", "xlsx-file-visuals.xlsx");

const anchor = (fromRow: number, fromColumn: number, toRow: number, toColumn: number) => ({
  fromRow, fromColumn, fromRowOffset: 0, fromColumnOffset: 0, toRow, toColumn, toRowOffset: 0, toColumnOffset: 0,
});
const moveFile = (file: number, at: ReturnType<typeof anchor>, sheet = "Data") => ({ op: "set_visual", target: { sheet }, attributes: { file, anchor: at } });
const removeFile = (file: number, sheet = "Data") => ({ op: "remove_visual", target: { sheet }, attributes: { file } });
const sheets = { sheetNames: () => ["Data", "Report"], nameForId: () => undefined };

function parseError(item: unknown): XlsxOpError {
  try {
    parseXlsxOps([item], sheets);
  } catch (error) {
    if (error instanceof XlsxOpError) return error;
    throw error;
  }
  throw new Error("expected a parse error");
}

const baseSnapshot = (): XlsxWorkbookSnapshot => ({
  revision: 0,
  sheets: [
    { id: "sheet-1", name: "Data", cells: {} },
    { id: "sheet-2", name: "Report", cells: {} },
  ],
});

function modelWith(operations: unknown[]) {
  const model = createXlsxSessionModel(baseSnapshot(), "sha-base");
  parseXlsxOps(operations, model.resolver({ "sheet-1": "Data", "sheet-2": "Report" }), (op) => model.applyEdit(op));
  return model;
}

describe("file visual ops: wire parser", () => {
  it("parses a file move and a file delete", () => {
    expect(parseXlsxOps([moveFile(2, anchor(1, 1, 4, 4)), removeFile(0)], sheets)).toEqual([
      { kind: "move_file_visual", sheetName: "Data", file: 2, anchor: anchor(1, 1, 4, 4) },
      { kind: "remove_file_visual", sheetName: "Data", file: 0 },
    ]);
  });

  it("refuses a file locator mixed with an id or a body, and an out-of-range index", () => {
    expect(parseError({ op: "set_visual", target: { sheet: "Data" }, attributes: { file: 0, id: "a", anchor: anchor(1, 1, 2, 2) } }).field).toBe("attributes");
    expect(parseError({ op: "set_visual", target: { sheet: "Data" }, attributes: { file: 0, anchor: anchor(1, 1, 2, 2), shape: { shapeType: "rect" } } }).field).toBe("attributes");
    expect(parseError({ op: "remove_visual", target: { sheet: "Data" }, attributes: { file: 0, id: "a" } }).field).toBe("attributes");
    expect(parseError(moveFile(-1, anchor(1, 1, 2, 2))).field).toBe("attributes.file");
    expect(parseError(removeFile(10_001)).field).toBe("attributes.file");
    expect(parseError(moveFile(0, anchor(4, 4, 2, 2))).field).toBe("attributes.anchor");
  });
});

describe("file visual ops in the session model", () => {
  it("keeps the last move per file visual, never as an addition, and refuses an edit after its delete", () => {
    const model = modelWith([moveFile(0, anchor(1, 1, 3, 3)), moveFile(0, anchor(5, 5, 9, 9)), removeFile(1)]);
    expect(model.pendingVisualAdditions()).toEqual([]);
    expect(model.isDirty).toBe(true);
    const edits = groupXlsxFileVisualEdits(model.visuals, (name) => (name === "Data" ? "xl/drawings/drawing1.xml" : null));
    expect(edits).toEqual([
      { drawingPath: "xl/drawings/drawing1.xml", drawingIndex: 0, anchor: anchor(5, 5, 9, 9) },
      { drawingPath: "xl/drawings/drawing1.xml", drawingIndex: 1, remove: true },
    ]);
    expect(() => model.applyEdit(parseXlsxOps([moveFile(1, anchor(1, 1, 2, 2))], sheets)[0]!)).toThrow(XlsxOpError);
    expect(() => groupXlsxFileVisualEdits(model.visuals, () => null)).toThrow(XlsxOpError);
  });

  it("follows a sheet rename and drops the edits of a removed sheet", () => {
    const model = modelWith([
      moveFile(0, anchor(1, 1, 3, 3)),
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Doanh thu" } },
      moveFile(0, anchor(2, 2, 4, 4), "Doanh thu"),
    ]);
    expect(model.visuals).toEqual([{ kind: "file_visual", sheetName: "Doanh thu", file: 0, anchor: anchor(2, 2, 4, 4) }]);
    parseXlsxOps([{ op: "remove_sheet", target: { sheet: "Doanh thu" } }], model.resolver({ "sheet-1": "Doanh thu", "sheet-2": "Report" }), (op) => model.applyEdit(op));
    expect(model.visuals).toEqual([]);
  });
});

describe("chart refs follow a sheet rename (review-visuals m4)", () => {
  const chart = {
    chartType: "column",
    title: "Sales",
    series: [{ name: "Q1", categories: ["N"], values: [1], valuesRef: "'Data'!$B$2:$B$3", categoriesRef: "Data!$A$2:$A$3" }],
  };

  it("rewrites quoted and unquoted refs to the new name and leaves other sheets alone", () => {
    const entries: XlsxVisualEntry[] = [
      { kind: "set_visual", sheetName: "Data", id: "c1", anchor: anchor(1, 1, 3, 3), chart: { ...chart, chartType: "column" } },
      { kind: "set_visual", sheetName: "Report", id: "c2", anchor: anchor(1, 1, 3, 3), chart: { ...chart, chartType: "column", series: [{ ...chart.series[0]!, valuesRef: "'MyData'!$B$2", categoriesRef: "Report!$A$1" }] } },
    ];
    const renamed = renameXlsxVisualSheet(entries, "Data", "Q1 'Doanh thu'");
    expect(renamed[0]).toMatchObject({ sheetName: "Q1 'Doanh thu'", chart: { series: [{ valuesRef: "'Q1 ''Doanh thu'''!$B$2:$B$3", categoriesRef: "'Q1 ''Doanh thu'''!$A$2:$A$3" }] } });
    expect(renamed[1]).toMatchObject({ sheetName: "Report", chart: { series: [{ valuesRef: "'MyData'!$B$2", categoriesRef: "Report!$A$1" }] } });
  });

  it("a chart inserted, then its sheet renamed, saves refs to the new name", () => {
    const model = modelWith([
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "c1", anchor: anchor(1, 1, 6, 5), chart } },
      { op: "rename_sheet", target: { sheet: "Data" }, attributes: { newName: "Doanh thu" } },
    ]);
    const [addition] = model.pendingVisualAdditions();
    expect(addition).toMatchObject({ sheetName: "Doanh thu", chart: { series: [{ valuesRef: "'Doanh thu'!$B$2:$B$3", categoriesRef: "'Doanh thu'!$A$2:$A$3" }] } });
  });
});

describe("file visual reader", () => {
  it("counts anchors the gateway's way, keeps Fallback copies as index slots and marks what can be edited", () => {
    const drawing =
      '<xdr:wsDr xmlns:xdr="x" xmlns:a="a" xmlns:mc="mc">' +
      '<xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
      '<xdr:to><xdr:col>3</xdr:col><xdr:colOff>9525</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
      '<xdr:cxnSp><xdr:nvCxnSpPr><xdr:cNvPr id="2" name="Line"/></xdr:nvCxnSpPr><xdr:spPr><a:prstGeom prst="straightConnector1"/></xdr:spPr></xdr:cxnSp></xdr:twoCellAnchor>' +
      '<mc:AlternateContent><mc:Choice Requires="sle15"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><a:graphicData uri="slicer"/></xdr:graphicFrame></xdr:twoCellAnchor></mc:Choice>' +
      '<mc:Fallback><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp><xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr></xdr:sp></xdr:twoCellAnchor></mc:Fallback></mc:AlternateContent>' +
      '<xdr:absoluteAnchor><xdr:pos x="9525" y="19050"/><xdr:ext cx="95250" cy="47625"/><xdr:grpSp/></xdr:absoluteAnchor>' +
      "</xdr:wsDr>";
    const parsed = parseDrawingXml(drawing).map((entry) => entry.visual);
    expect(parsed.map((visual) => [visual.index, visual.kind, visual.editable])).toEqual([
      [0, "shape", true],
      [1, "other", false],
      [2, "other", false],
      [3, "other", false],
    ]);
    expect(parsed[0]).toMatchObject({ shape: { shapeType: "line" }, anchor: { ...anchor(2, 1, 5, 3), toColumnOffset: 9525 } });
    expect(parsed[3]).toMatchObject({ position: { x: 9525, y: 19050 }, extent: { cx: 95250, cy: 47625 } });
  });

  it("reads a chart's plot type, title and cached series (gaps read as 0), and leaves unknown plots undrawn", () => {
    const pt = (idx: number, v: string) => `<c:pt idx="${idx}"><c:v>${v}</c:v></c:pt>`;
    const xml =
      '<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Doanh &amp; thu</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:lineChart>' +
      `<c:ser><c:tx><c:v>Plan</c:v></c:tx><c:cat><c:strRef><c:f>'S 1'!$A$1:$A$3</c:f><c:strCache><c:ptCount val="3"/>${pt(0, "a")}${pt(1, "b")}${pt(2, "c")}</c:strCache></c:strRef></c:cat>` +
      `<c:val><c:numRef><c:f>'S 1'!$B$1:$B$3</c:f><c:numCache><c:ptCount val="3"/>${pt(0, "1")}${pt(2, "3.5")}</c:numCache></c:numRef></c:val></c:ser>` +
      "</c:lineChart></c:plotArea></c:chart></c:chartSpace>";
    expect(parseChartXml(xml)).toEqual({
      title: "Doanh & thu",
      chart: { chartType: "line", title: "Doanh & thu", series: [{ name: "Plan", categories: ["a", "b", "c"], values: [1, 0, 3.5], valuesRef: "'S 1'!$B$1:$B$3", categoriesRef: "'S 1'!$A$1:$A$3" }] },
    });
    expect(parseChartXml("<c:chartSpace><c:chart><c:autoTitleDeleted val=\"1\"/><c:plotArea><c:radarChart><c:ser/></c:radarChart></c:plotArea></c:chart></c:chartSpace>")).toEqual({ title: "" });
  });

  it("reads nothing for a sheet without a drawing, tolerates missing parts and a failing reader", async () => {
    expect(await readSheetVisuals([{ path: "xl/worksheets/sheet1.xml" }], async () => { throw new Error("boom"); })).toEqual([[{ index: -1, kind: "other", editable: false, unread: true }]]);
    const texts: Record<string, string | null> = {
      "xl/worksheets/_rels/sheet1.xml.rels": '<Relationships><Relationship Id="rId1" Type="http://x/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
      "xl/drawings/drawing1.xml": null,
    };
    const read = await readSheetVisuals([{ path: "xl/worksheets/sheet1.xml" }, { path: "xl/worksheets/sheet2.xml" }, {}], async (paths) =>
      Object.fromEntries(paths.map((path) => [path, texts[path] ?? null])));
    expect(read).toEqual([[], [], []]);
  });
});

describeWithPatchedGateway("file visuals over the real gateway artifact", () => {
  const source = () => new Uint8Array(readFileSync(FIXTURE));

  it("lists the file's chart, picture, shape and oneCellAnchor picture in drawing order", async () => {
    const engine = await loadPatchedGateway();
    const model = await readXlsxRenderModel(engine, source());
    const visuals = model.sheets[0]?.visuals ?? [];
    expect(visuals.map((visual) => [visual.index, visual.kind, visual.editable])).toEqual([
      [0, "chart", true],
      [1, "picture", true],
      [2, "shape", true],
      [3, "picture", false],
    ]);
    expect(visuals[0]).toMatchObject({
      name: "Chart 1",
      anchor: { fromRow: 1, fromColumn: 4, toRow: 15, toColumn: 11, toColumnOffset: 304800, toRowOffset: 76200 },
      chartTitle: "Doanh thu 2026",
      chart: { chartType: "column", series: [{ name: "Q1", categories: ["North", "South", "East"], values: [12.5, 0, 15.7], valuesRef: "Data!$B$2:$B$4" }, { name: "Q2", values: [7.8, 3, 8.6] }] },
    });
    expect(visuals[1]?.image?.mediaType).toBe("image/png");
    expect(Buffer.from(visuals[1]!.image!.base64, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect(visuals[2]).toMatchObject({ shape: { shapeType: "roundRect", fillColor: "#70AD47", text: "Ghi chú" } });
    expect(visuals[3]).toMatchObject({ extent: { cx: 952500, cy: 952500 }, anchor: { fromRow: 1, fromColumn: 13 } });
    expect(await readDrawingPathsBySheet((paths) => engine.readEntriesText(source(), paths))).toEqual(new Map([["Data", "xl/drawings/drawing1.xml"]]));
  });

  it("moves and deletes file visuals with a session insert, and a visual that save wrote is edited by its next index", async () => {
    const engine = await loadPatchedGateway();
    const adapter = createXlsxAdapter({ engine });
    const opened = await adapter.open({ bytes: source(), format: "xlsx", document_id: "file-visuals" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    adapter.edit(opened.document_model_ref, [
      moveFile(0, anchor(20, 1, 30, 6)),
      removeFile(2),
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "s1", anchor: anchor(1, 1, 3, 3), shape: { shapeType: "ellipse", fillColor: "#4472C4" } } },
    ]);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    adapter.release(opened.document_model_ref);

    // Survivors compact (0, 1, 3 -> 0, 1, 2) and the session insert appends:
    // the renumbering the editor applies after a save.
    const after = (await readXlsxRenderModel(engine, saved.bytes)).sheets[0]?.visuals ?? [];
    expect(after.map((visual) => [visual.index, visual.kind])).toEqual([[0, "chart"], [1, "picture"], [2, "picture"], [3, "shape"]]);
    expect(after[0]?.anchor).toMatchObject({ fromRow: 20, fromColumn: 1, toRow: 30, toColumn: 6 });
    expect(after[3]).toMatchObject({ editable: true, shape: { shapeType: "ellipse", fillColor: "#4472C4" } });

    // Save 2 edits the visual save 1 wrote, through its file index.
    const second = createXlsxAdapter({ engine });
    const reopened = await second.open({ bytes: saved.bytes, format: "xlsx", document_id: "file-visuals-2" });
    if (reopened.outcome !== "opened") throw new Error("reopen_failed");
    second.edit(reopened.document_model_ref, [moveFile(3, anchor(8, 8, 12, 12)), removeFile(0)]);
    const savedTwice = await second.serialize({ document_model_ref: reopened.document_model_ref, format: "xlsx" });
    const final = (await readXlsxRenderModel(engine, savedTwice.bytes)).sheets[0]?.visuals ?? [];
    expect(final.map((visual) => visual.kind)).toEqual(["picture", "picture", "shape"]);
    expect(final[2]?.anchor).toMatchObject({ fromRow: 8, fromColumn: 8, toRow: 12, toColumn: 12 });
    // Deleting the chart took its part with it.
    const paths = (await engine.inventory(savedTwice.bytes)).map((entry) => entry.path);
    expect(paths.some((path) => path.startsWith("xl/charts/"))).toBe(false);
  });
});

// r2: structural edits shift visual anchors exactly as the gateway shifts
// the file's own drawing anchors (xlsx-structure.ts shiftDrawingAnchors).
const rows = (op: "insert_rows" | "remove_rows" | "insert_cols" | "remove_cols", index: number, count: number, sheet = "Data") => ({ op, target: { sheet }, attributes: { index, count } });

describe("visual anchors follow row and column inserts and deletes", () => {
  const at = { fromRow: 4, fromColumn: 2, fromRowOffset: 100, fromColumnOffset: 200, toRow: 8, toColumn: 5, toRowOffset: 300, toColumnOffset: 400 };

  it("shifts marks at or after an insert and clamps marks inside a deleted band to its start with no offset", () => {
    expect(shiftXlsxVisualAnchor(at, { kind: "insert_rows", index: 4, count: 2 })).toEqual({ ...at, fromRow: 6, toRow: 10 });
    expect(shiftXlsxVisualAnchor(at, { kind: "insert_rows", index: 9, count: 2 })).toEqual(at);
    expect(shiftXlsxVisualAnchor(at, { kind: "insert_cols", index: 3, count: 1 })).toEqual({ ...at, toColumn: 6 });
    expect(shiftXlsxVisualAnchor(at, { kind: "remove_rows", index: 0, count: 2 })).toEqual({ ...at, fromRow: 2, toRow: 6 });
    expect(shiftXlsxVisualAnchor(at, { kind: "remove_rows", index: 3, count: 3 })).toEqual({ ...at, fromRow: 3, fromRowOffset: 0, toRow: 5 });
    expect(shiftXlsxVisualAnchor(at, { kind: "remove_cols", index: 5, count: 4 })).toEqual({ ...at, toColumn: 5, toColumnOffset: 0 });
  });

  it("shifts pending session visuals and file-visual moves on that sheet only, not visuals inserted after the op", () => {
    const model = modelWith([
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "s1", anchor: anchor(10, 1, 12, 3), shape: { shapeType: "rect" } } },
      moveFile(0, anchor(5, 1, 7, 3)),
      { op: "set_visual", target: { sheet: "Report" }, attributes: { id: "r1", anchor: anchor(10, 1, 12, 3), shape: { shapeType: "rect" } } },
      rows("insert_rows", 0, 3),
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "s2", anchor: anchor(1, 1, 2, 2), shape: { shapeType: "rect" } } },
    ]);
    const byKey = Object.fromEntries(model.visuals.map((visual) => [visual.kind === "file_visual" ? `file${visual.file}` : visual.id, visual.anchor]));
    expect(byKey).toEqual({ s1: anchor(13, 1, 15, 3), file0: anchor(8, 1, 10, 3), r1: anchor(10, 1, 12, 3), s2: anchor(1, 1, 2, 2) });
  });
});

const EXCEL_FIXTURE = join(HERE, "fixtures", "xlsx-visuals", "xlsx-excel-visuals.xlsx");

describeWithPatchedGateway("Excel-saved file visuals over the real gateway artifact", () => {
  const source = () => new Uint8Array(readFileSync(EXCEL_FIXTURE));
  const visualsOf = async (bytes: Uint8Array) => (await readXlsxRenderModel(await loadPatchedGateway(), bytes)).sheets[0]?.visuals ?? [];
  const save = async (bytes: Uint8Array, edits: unknown[]) => {
    const adapter = createXlsxAdapter({ engine: await loadPatchedGateway() });
    const opened = await adapter.open({ bytes, format: "xlsx", document_id: `excel-${Math.random()}` });
    if (opened.outcome !== "opened") throw new Error("open_failed");
    adapter.edit(opened.document_model_ref, edits);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    adapter.release(opened.document_model_ref);
    return saved.bytes;
  };

  it("reads the chart, picture and shape Excel wrote", async () => {
    const visuals = await visualsOf(source());
    expect(visuals.map((visual) => [visual.index, visual.kind, visual.editable])).toEqual([[0, "chart", true], [1, "picture", true], [2, "shape", true]]);
    expect(visuals[0]).toMatchObject({
      anchor: { fromRow: 1, fromColumn: 4, toRow: 15, toColumn: 11 },
      chartTitle: "Doanh thu",
      chart: { chartType: "column", series: [{ name: "Q1", categories: ["North", "South", "East"], values: [12.5, 9, 15.7], valuesRef: "Data!$B$2:$B$4" }, { name: "Q2", values: [7.8, 3, 8.6] }] },
    });
    expect(visuals[1]).toMatchObject({ anchor: { fromRow: 6, fromColumn: 0 }, image: { mediaType: "image/png" } });
    expect(visuals[2]).toMatchObject({ anchor: { fromRow: 13, fromColumn: 0 }, shape: { shapeType: "roundRect", fillColor: "#70AD47", text: "Ghi chu" } });
  });

  it("moves, deletes and inserts on Excel's drawing, then edits the visual that save wrote", async () => {
    const once = await save(source(), [
      moveFile(0, anchor(20, 1, 30, 6)),
      removeFile(1),
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "s1", anchor: anchor(1, 1, 3, 3), shape: { shapeType: "ellipse", fillColor: "#4472C4" } } },
    ]);
    expect((await visualsOf(once)).map((visual) => [visual.index, visual.kind, visual.anchor?.fromRow])).toEqual([[0, "chart", 20], [1, "shape", 13], [2, "shape", 1]]);
    const twice = await save(once, [moveFile(2, anchor(8, 8, 12, 12)), removeFile(0)]);
    const final = await visualsOf(twice);
    expect(final.map((visual) => [visual.kind, visual.anchor?.fromRow])).toEqual([["shape", 13], ["shape", 8]]);
    expect((await (await loadPatchedGateway()).inventory(twice)).some((entry) => entry.path.startsWith("xl/charts/chart"))).toBe(false);
  });

  it("rows inserted above the chart move it in the saved file, and so do pending moves and inserts", async () => {
    const saved = await save(source(), [
      moveFile(2, anchor(20, 0, 24, 2)),
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "s1", anchor: anchor(30, 1, 32, 3), shape: { shapeType: "rect" } } },
      rows("insert_rows", 0, 3),
      rows("remove_cols", 3, 1), // column D: the chart refs (A:C) stay whole
    ]);
    const visuals = await visualsOf(saved);
    expect(visuals.map((visual) => [visual.kind, visual.anchor?.fromRow, visual.anchor?.fromColumn, visual.anchor?.toRow, visual.anchor?.toColumn])).toEqual([
      ["chart", 4, 3, 18, 10], // gateway shift of a file anchor
      ["picture", 9, 0, 14, 2], // left of the deleted column
      ["shape", 23, 0, 27, 2], // pending file move, shifted by the engine
      ["shape", 33, 1, 35, 3], // pending session insert: its right edge sat in column D, clamped
    ]);
    // The overlay's own shift (the same helper) predicts every saved anchor.
    const before = await visualsOf(source());
    const predicted = before.map((visual) => [{ kind: "insert_rows", index: 0, count: 3 }, { kind: "remove_cols", index: 3, count: 1 }].reduce((current, shift) => shiftXlsxVisualAnchor(current, shift as never), visual.anchor!));
    expect(predicted[0]).toEqual(visuals[0]?.anchor);
    expect(predicted[1]).toEqual(visuals[1]?.anchor);
  });
});
