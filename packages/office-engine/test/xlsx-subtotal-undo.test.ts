// visual-final MAJOR 1 (UNI-953): Data > Subtotal over A1:C5 of the
// kitchen-sink workbook (file list DV on A2:A4, cellIs CF on B2:B4, SUM in row
// 6), then Undo, then Save. The op envelopes are the ones the web editor sent
// for that sequence (captured from the live app): eleven for the Subtotal and
// the one envelope the grid edit queue now coalesces the Undo's ~30 renderer
// batches into (row removals, CF/DV rule-set snapshots, formula rewrites).
// Applied through the adapter's full path on the REAL patched gateway, the
// saved file must read back exactly as the fixture was.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { bindXlsxGateway, createXlsxAdapter, readXlsxRenderModel, type XlsxRecalcPort, type XlsxWorkbookSnapshot } from "../src/xlsx";
import { ARTIFACT, describeWithPatchedGateway } from "./xlsx-patched-gateway";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const KITCHEN_SINK = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets", "xlsx-kitchen-sink.xlsx");

type Envelope = readonly Record<string, unknown>[];
const trace = JSON.parse(readFileSync(join(HERE, "fixtures", "xlsx-subtotal-undo", "kitchen-sink-subtotal-undo.json"), "utf8")) as {
  subtotal: Envelope[];
  undo: Envelope;
};

type Gateway = Awaited<ReturnType<typeof load>>;
const load = async () => bindXlsxGateway((await import(pathToFileURL(ARTIFACT).href)) as never);

/** Formula writes need a recalc port; this one leaves the caches (the
 *  structural tests do the same). */
const keepCaches: XlsxRecalcPort = { async recalc() { return { cells: [], cached: false }; }, async close() {} };

async function saveAfter(engine: Gateway, envelopes: readonly Envelope[]): Promise<Uint8Array> {
  const adapter = createXlsxAdapter({ engine, recalc: keepCaches });
  const opened = await adapter.open({ bytes: new Uint8Array(readFileSync(KITCHEN_SINK)), format: "xlsx", document_id: "subtotal-undo" });
  if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
  for (const envelope of envelopes) adapter.edit(opened.document_model_ref, envelope);
  const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
  adapter.release(opened.document_model_ref);
  return saved.bytes;
}

const dataCells = (snapshot: XlsxWorkbookSnapshot) => snapshot.sheets.find((sheet) => sheet.name === "Data")?.cells ?? {};

async function sheetXml(engine: Gateway, bytes: Uint8Array): Promise<string> {
  const xml = await engine.readEntryText(bytes, "xl/worksheets/sheet1.xml");
  if (xml === null) throw new Error("sheet1 part missing");
  return xml;
}

describeWithPatchedGateway("xlsx Subtotal then Undo on a workbook with file CF/DV rules", () => {
  it("the captured Subtotal envelopes add the subtotal rows and outline", async () => {
    const engine = await load();
    const bytes = await saveAfter(engine, trace.subtotal);
    const cells = dataCells((await engine.readWorkbook(bytes)).snapshot);
    expect(cells.A3?.value).toBe("Tổng Doanh thu");
    expect(Object.values(cells).some((cell) => cell.value === "Tổng chung")).toBe(true);
    const data = (await readXlsxRenderModel(engine, bytes)).sheets.find((sheet) => sheet.name === "Data");
    expect(data?.rowsMeta.some((meta) => (meta.outlineLevel ?? 0) > 0)).toBe(true);
  });

  it("the coalesced Undo envelope restores the fixture's cells, rules and outline through save and reopen", async () => {
    const engine = await load();
    const original = await engine.readWorkbook(new Uint8Array(readFileSync(KITCHEN_SINK)));
    const bytes = await saveAfter(engine, [...trace.subtotal, trace.undo]);
    const reopened = dataCells((await engine.readWorkbook(bytes)).snapshot);
    const before = dataCells(original.snapshot);
    for (const address of ["A1", "A2", "A3", "A4", "A5", "A6", "B2", "B5", "C3", "C5"]) {
      expect({ address, value: reopened[address]?.value ?? null }).toEqual({ address, value: before[address]?.value ?? null });
    }
    expect(reopened.B6?.formula).toBe(before.B6?.formula);
    expect(reopened.C6?.formula).toBe(before.C6?.formula);
    expect(Object.values(reopened).some((cell) => typeof cell.value === "string" && cell.value.startsWith("Tổng"))).toBe(false);
    expect(Object.keys(reopened).some((address) => /^[A-C](7|8|9|10)$/.test(address) && reopened[address]?.value != null)).toBe(false);
    const xml = await sheetXml(engine, bytes);
    expect(xml).toContain('sqref="A2:A4"');
    expect(xml).toContain('sqref="B2:B4"');
    const data = (await readXlsxRenderModel(engine, bytes)).sheets.find((sheet) => sheet.name === "Data");
    expect(data?.rowsMeta.every((meta) => (meta.outlineLevel ?? 0) === 0)).toBe(true);
  });
});
