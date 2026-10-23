// review-visuals fixes for file-native visuals (UNI-953 X02):
// V1 the picture budget is enforced before anything is inflated, V2 the
// anchor count survives the listing cap and a failed read, V4 the save path
// refuses edits of anchors the editor shows as fixed, V8 a deleted band that
// covers a visual collapses it on both paths (Excel and gateway parity).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";
import { createXlsxAdapter, readXlsxRenderModel, XlsxOpError } from "../src/xlsx";
import { shiftXlsxVisualAnchor, type XlsxVisualEntry } from "../src/xlsx/ops-visuals";
import {
  parseDrawingXml,
  readSheetVisuals,
  resolveFileVisualEdits,
  XLSX_FILE_VISUAL_MAX_IMAGE_BYTES,
  XLSX_FILE_VISUAL_MAX_TOTAL_IMAGE_BYTES,
} from "../src/xlsx/render-model-visuals";
import { describeWithPatchedGateway, loadPatchedGateway } from "./xlsx-patched-gateway";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "xlsx-visuals", "xlsx-file-visuals.xlsx");
const EXCEL_FIXTURE = join(HERE, "fixtures", "xlsx-visuals", "xlsx-excel-visuals.xlsx");

const anchor = (fromRow: number, fromColumn: number, toRow: number, toColumn: number) => ({
  fromRow, fromColumn, fromRowOffset: 0, fromColumnOffset: 0, toRow, toColumn, toRowOffset: 0, toColumnOffset: 0,
});
const moveFile = (file: number, at: ReturnType<typeof anchor>, sheet = "Data") => ({ op: "set_visual", target: { sheet }, attributes: { file, anchor: at } });
const removeFile = (file: number, sheet = "Data") => ({ op: "remove_visual", target: { sheet }, attributes: { file } });
const rows = (op: "insert_rows" | "remove_rows", index: number, count: number) => ({ op, target: { sheet: "Data" }, attributes: { index, count } });

const marker = (tag: string, row: number, column: number) =>
  `<xdr:${tag}><xdr:col>${column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
const twoCell = (row: number, body = '<xdr:sp><xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr></xdr:sp>') =>
  `<xdr:twoCellAnchor>${marker("from", row, 0)}${marker("to", row + 1, 1)}${body}<xdr:clientData/></xdr:twoCellAnchor>`;
const drawingOf = (anchors: string) => `<xdr:wsDr xmlns:xdr="x" xmlns:a="a" xmlns:mc="mc">${anchors}</xdr:wsDr>`;

/** A package that is just enough for the drawing lookup: one sheet "Data"
 *  whose drawing is `drawing`. */
function packageReader(drawing: string, extra: Record<string, string> = {}) {
  const texts: Record<string, string> = {
    "xl/workbook.xml": '<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Type="http://x/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/_rels/sheet1.xml.rels": '<Relationships><Relationship Id="rId1" Type="http://x/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    "xl/drawings/drawing1.xml": drawing,
    ...extra,
  };
  return async (paths: readonly string[]) => Object.fromEntries(paths.map((path) => [path, texts[path] ?? null]));
}

/** A minimal ZIP (local headers + central directory) with stored or deflated entries. */
function zipOf(entries: readonly { name: string; data: Uint8Array; deflate?: boolean }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = entry.deflate ? deflateRawSync(entry.data) : Buffer.from(entry.data);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe("V1: picture bytes are read under both budgets", () => {
  it("hands the reader the per-picture cap and the workbook budget", async () => {
    const pictures = Array.from({ length: 3 }, (_, at) => twoCell(at * 3, `<xdr:pic><xdr:blipFill><a:blip r:embed="rId${at + 1}"/></xdr:blipFill></xdr:pic>`)).join("");
    const rels = `<Relationships>${[1, 2, 3].map((at) => `<Relationship Id="rId${at}" Type="http://x/image" Target="../media/image${at}.png"/>`).join("")}</Relationships>`;
    const read = packageReader(drawingOf(pictures), { "xl/drawings/_rels/drawing1.xml.rels": rels });
    const calls: unknown[][] = [];
    const visuals = await readSheetVisuals([{ path: "xl/worksheets/sheet1.xml" }], read, async (paths, maxBytes, maxTotalBytes) => {
      calls.push([paths, maxBytes, maxTotalBytes]);
      return Object.fromEntries(paths.map((path) => [path, path.endsWith("2.png") ? null : "iVBORw0K"]));
    });
    expect(calls).toEqual([[["xl/media/image1.png", "xl/media/image2.png", "xl/media/image3.png"], XLSX_FILE_VISUAL_MAX_IMAGE_BYTES, XLSX_FILE_VISUAL_MAX_TOTAL_IMAGE_BYTES]]);
    expect(visuals[0]?.map((visual) => visual.image !== undefined)).toEqual([true, false, true]);
  });
});

describe("V2: the anchor count is kept past the listing cap and when the read fails", () => {
  it("lists the first 1,000 anchors and one trailing slot that carries the last index", () => {
    const parsed = parseDrawingXml(drawingOf(Array.from({ length: 1_003 }, (_, at) => twoCell(at)).join(""))).map((entry) => entry.visual);
    expect(parsed).toHaveLength(1_001);
    expect(parsed[999]).toMatchObject({ index: 999, kind: "shape", editable: true });
    expect(parsed[1_000]).toEqual({ index: 1_002, kind: "other", editable: false });
    expect(parseDrawingXml(drawingOf(Array.from({ length: 1_000 }, (_, at) => twoCell(at)).join("")))).toHaveLength(1_000);
  });

  it("marks every sheet unread when the drawing read throws", async () => {
    const read = await readSheetVisuals([{ path: "xl/worksheets/sheet1.xml" }, {}], async () => {
      throw new Error("boom");
    });
    expect(read).toEqual([[{ index: -1, kind: "other", editable: false, unread: true }], [{ index: -1, kind: "other", editable: false, unread: true }]]);
  });
});

describe("V4: the save path refuses edits of anchors the editor shows as fixed", () => {
  const drawing = drawingOf(
    twoCell(0) +
      `<xdr:oneCellAnchor>${marker("from", 4, 0)}<xdr:ext cx="9525" cy="9525"/><xdr:sp><xdr:spPr/></xdr:sp><xdr:clientData/></xdr:oneCellAnchor>` +
      `<mc:AlternateContent><mc:Choice Requires="a14">${twoCell(6)}</mc:Choice><mc:Fallback>${twoCell(6)}</mc:Fallback></mc:AlternateContent>` +
      twoCell(9, '<xdr:grpSp><xdr:sp><xdr:spPr/></xdr:sp></xdr:grpSp>'),
  );
  const fileEdit = (file: number, remove = false): XlsxVisualEntry =>
    ({ kind: "file_visual", sheetName: "Data", file, ...(remove ? { remove: true } : { anchor: anchor(1, 1, 2, 2) }) }) as XlsxVisualEntry;
  const resolve = (visuals: XlsxVisualEntry[]) => resolveFileVisualEdits(visuals, (name) => name, packageReader(drawing));

  it("passes a move and a delete of a two-cell anchor", async () => {
    expect(await resolve([fileEdit(0)])).toEqual([{ drawingPath: "xl/drawings/drawing1.xml", drawingIndex: 0, anchor: anchor(1, 1, 2, 2) }]);
    expect(await resolve([fileEdit(0, true)])).toEqual([{ drawingPath: "xl/drawings/drawing1.xml", drawingIndex: 0, remove: true }]);
    expect(await resolve([])).toEqual([]);
  });

  it.each([
    ["a one-cell anchor", 1],
    ["the Choice copy of an AlternateContent pair", 2],
    ["its Fallback copy", 3],
    ["a group", 4],
    ["an index past the drawing", 9],
  ])("refuses a move and a delete of %s", async (_label, file) => {
    for (const edit of [fileEdit(file), fileEdit(file, true)]) {
      const refused = await resolve([fileEdit(0), edit]).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(XlsxOpError);
      expect((refused as XlsxOpError).field).toBe("attributes.file");
      expect((refused as Error).message).toMatch(/cannot be moved, resized or deleted/);
    }
  });
});

describeWithPatchedGateway("review-visuals fixes over the real gateway artifact", () => {
  const visualsOf = async (bytes: Uint8Array) => (await readXlsxRenderModel(await loadPatchedGateway(), bytes)).sheets[0]?.visuals ?? [];
  const save = async (bytes: Uint8Array, edits: unknown[]) => {
    const adapter = createXlsxAdapter({ engine: await loadPatchedGateway() });
    const opened = await adapter.open({ bytes, format: "xlsx", document_id: `review-${Math.random()}` });
    if (opened.outcome !== "opened") throw new Error("open_failed");
    try {
      adapter.edit(opened.document_model_ref, edits);
      return (await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" })).bytes;
    } finally {
      adapter.release(opened.document_model_ref);
    }
  };

  it("V1: readEntriesBase64 stops at the per-entry cap and the workbook budget, in order", async () => {
    const engine = await loadPatchedGateway();
    const kib = (count: number, fill: number) => new Uint8Array(count * 1024).fill(fill);
    const bytes = zipOf([
      { name: "a.png", data: kib(300, 1) },
      { name: "big.png", data: kib(600, 2), deflate: true },
      { name: "b.png", data: kib(300, 3), deflate: true },
      { name: "c.png", data: kib(300, 4) },
      { name: "d.png", data: kib(100, 5) },
    ]);
    const read = await engine.readEntriesBase64!(bytes, ["a.png", "big.png", "b.png", "c.png", "d.png", "missing.png"], 512 * 1024, 700 * 1024);
    // big.png is over the cap; c.png no longer fits after a + b; d.png still does.
    expect(Object.fromEntries(Object.entries(read).map(([path, value]) => [path, value === null ? null : Buffer.from(value, "base64").length / 1024]))).toEqual({
      "a.png": 300, "big.png": null, "b.png": 300, "c.png": null, "d.png": 100, "missing.png": null,
    });
  });

  it("V4: a save that moves or deletes a one-cell anchor is refused", async () => {
    const source = new Uint8Array(readFileSync(FIXTURE));
    expect((await visualsOf(source))[3]).toMatchObject({ kind: "picture", editable: false });
    await expect(save(source, [moveFile(3, anchor(1, 1, 4, 4))])).rejects.toThrow(/cannot be moved, resized or deleted/);
    await expect(save(source, [removeFile(3)])).rejects.toThrow(/cannot be moved, resized or deleted/);
  });

  it("V8: rows deleted over a whole visual collapse it to the band start on both paths, as Excel does", async () => {
    const source = new Uint8Array(readFileSync(EXCEL_FIXTURE));
    const before = await visualsOf(source);
    const shape = before[2]!;
    // The shape sits below the chart's data (rows 2-4); delete every row it spans.
    const band = { kind: "remove_rows" as const, index: shape.anchor!.fromRow - 1, count: shape.anchor!.toRow - shape.anchor!.fromRow + 3 };
    const saved = await save(source, [
      { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "s1", anchor: anchor(40, 1, 42, 3), shape: { shapeType: "rect" } } },
      rows("remove_rows", band.index, band.count),
      rows("remove_rows", 39 - band.count, 5),
    ]);
    const after = await visualsOf(saved);
    const collapsed = (row: number) => ({ fromRow: row, toRow: row, fromRowOffset: 0, toRowOffset: 0 });
    // Gateway path: the file's own anchor; engine path: the pending session insert.
    expect(after[2]?.anchor).toMatchObject(collapsed(band.index));
    expect(after[2]?.anchor).toEqual(shiftXlsxVisualAnchor(shape.anchor!, band));
    expect(after[3]?.anchor).toMatchObject(collapsed(39 - band.count));
  });
});
