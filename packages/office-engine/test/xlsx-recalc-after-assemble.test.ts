// R3-1: structural and sheet-identity saves refresh formula caches by
// recalculating the PRODUCED bytes (zero edits, final names and coordinates)
// and running a values-only second assemble. Over the REAL gateway artifact
// with a deterministic answering recalc port, so the <v> a test reads back
// provably comes from a recalc over the produced package. The gateway is the
// REAL artifact; the only fake is the recalc port (the real-sidecar proof is
// in the g2-04 replay, test/replay/g2-04-replay.mjs).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bindXlsxGateway, createXlsxAdapter, readXlsxRenderModel, type XlsxRecalcEdit, type XlsxRecalcPort, type XlsxRecalcRead } from "../src/xlsx";
import { a1ToRowColumn } from "../src/xlsx/ops-shared";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const ARTIFACT = join(REPO, ".go-tmp", "office-upstream-build", "dist", "xlsx-gateway.mjs");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");
const KITCHEN_SINK = "xlsx-kitchen-sink.xlsx";
const COMPAT_EDIT = "xlsx-compatibility-edit.xlsx";

type Gateway = Awaited<ReturnType<typeof load>>;
type Adapter = ReturnType<typeof createXlsxAdapter>;
const load = async () => {
  const mod = await import(pathToFileURL(ARTIFACT).href);
  return bindXlsxGateway(mod as never);
};
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

/** The value the fake engine answers for a 0-based formula coordinate. */
const answer = (row: number, column: number): number => 1000 * row + column + 0.5;

interface RecalcCall {
  readonly bytes: Uint8Array;
  readonly edits: readonly XlsxRecalcEdit[];
  readonly reads: readonly XlsxRecalcRead[];
}

/** Answers every formula cell its bytes hold inside the requested ranges,
 *  except those `skip` names ("Sheet row,column"). */
function answeringRecalc(engine: Gateway, skip: ReadonlySet<string> = new Set()): XlsxRecalcPort & { calls: RecalcCall[] } {
  const port = {
    calls: [] as RecalcCall[],
    async recalc(bytes: Uint8Array, edits: readonly XlsxRecalcEdit[], reads: readonly XlsxRecalcRead[]) {
      port.calls.push({ bytes, edits, reads });
      const { snapshot } = await engine.readWorkbook(bytes);
      const cells = [];
      for (const read of reads) {
        const sheet = snapshot.sheets.find((candidate) => candidate.name === read.sheet);
        for (const [address, cell] of Object.entries(sheet?.cells ?? {})) {
          if (cell.formula === undefined) continue;
          const { row, column } = a1ToRowColumn(address, "<test>", "address");
          const { startRow, endRow, startColumn, endColumn } = read.range;
          if (row < startRow || row > endRow || column < startColumn || column > endColumn) continue;
          if (skip.has(`${read.sheet} ${row},${column}`)) continue;
          cells.push({
            sheet: read.sheet,
            row,
            column,
            formatted: String(answer(row, column)),
            number: answer(row, column),
            isError: false,
            isFormula: true,
          });
        }
      }
      return { cells, cached: false };
    },
    async close() {},
  };
  return port;
}

async function openSession(adapter: Adapter, bytes: Uint8Array): Promise<string> {
  const opened = await adapter.open({ bytes, format: "xlsx", document_id: "after-assemble" });
  if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
  return opened.document_model_ref;
}

async function save(adapter: Adapter, ref: string, ops: readonly Record<string, unknown>[]) {
  adapter.edit(ref, ops);
  const saved = await adapter.serialize({ document_model_ref: ref, format: "xlsx" });
  return { bytes: saved.bytes, warnings: (saved.warnings ?? []) as { code: string; detail: string }[] };
}

/** The worksheet part XML of a sheet, resolved through workbook.xml + rels. */
async function sheetXml(engine: Gateway, bytes: Uint8Array, sheetName: string): Promise<string> {
  const workbook = (await engine.readEntryText(bytes, "xl/workbook.xml")) ?? "";
  const rels = (await engine.readEntryText(bytes, "xl/_rels/workbook.xml.rels")) ?? "";
  const tag = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`name="${sheetName}"`));
  const rid = /r:id="([^"]+)"/.exec(tag ?? "")?.[1];
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`));
  const target = /Target="([^"]+)"/.exec(rel ?? "")?.[1];
  if (target === undefined) throw new Error(`no worksheet part for ${sheetName}`);
  const xml = await engine.readEntryText(bytes, "xl/" + target.replace(/^\/?(xl\/)?/, ""));
  if (xml === null) throw new Error(`worksheet part ${target} missing`);
  return xml;
}

const cellXml = (xml: string, address: string): string =>
  new RegExp(`<c r="${address}"[^>]*>.*?</c>`).exec(xml)?.[0] ?? "";

const cachedValue = (xml: string, address: string): string | undefined =>
  /<v>([^<]*)<\/v>/.exec(cellXml(xml, address))?.[1];

describe.skipIf(!existsSync(ARTIFACT))("xlsx recalc over the produced bytes (R3-1)", () => {
  it("refreshes every formula cache after a sort, new formula, add + rename sheet save", async () => {
    const engine = await load();
    const recalc = answeringRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, fixture(KITCHEN_SINK));
    const sort = [
      // A2:C4 sorted: rows 2 and 4 swap.
      { op: "set_cell", target: { sheet: "Data", cell: "A2" }, attributes: { value: "Lợi nhuận" } },
      { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 1_570_000_000 } },
      { op: "set_cell", target: { sheet: "Data", cell: "C2" }, attributes: { value: 860_000_000 } },
      { op: "set_cell", target: { sheet: "Data", cell: "A4" }, attributes: { value: "Doanh thu" } },
      { op: "set_cell", target: { sheet: "Data", cell: "B4" }, attributes: { value: 2_000_000_000 } },
      { op: "set_cell", target: { sheet: "Data", cell: "C4" }, attributes: { value: 780_000_000 } },
    ];
    const saved = await save(adapter, ref, [
      { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 2_000_000_000 } },
      { op: "set_cell", target: { sheet: "Data", cell: "B8" }, attributes: { formula: "=SUM(B2:B4)" } },
      ...sort,
      { op: "add_sheet", attributes: { name: "Sheet", index: 2 } },
      { op: "rename_sheet", target: { sheet: "Sheet" }, attributes: { newName: "Tổng hợp" } },
      { op: "set_cell", target: { sheet: "Data", cell: "A10" }, attributes: { value: "ghi chú" } },
    ]);
    expect(saved.warnings.some((w) => w.code === "sheet_formula_cache_kept")).toBe(false);
    expect(saved.warnings.some((w) => w.code === "formula_cache_kept")).toBe(false);

    // The last recalc ran with NO edits over the produced package.
    const last = recalc.calls.at(-1);
    expect(last?.edits).toEqual([]);
    const names = (await engine.readWorkbook(last!.bytes)).snapshot.sheets.map((s) => s.name);
    expect(names).toEqual(["Data", "PhuLuc", "Tổng hợp"]);

    const data = await sheetXml(engine, saved.bytes, "Data");
    expect(cellXml(data, "B6")).toContain("<f>SUM(B2:B4)</f>");
    expect(cachedValue(data, "B6")).toBe(String(answer(5, 1)));
    expect(cachedValue(data, "C6")).toBe(String(answer(5, 2)));
    expect(cellXml(data, "B8")).toContain("<f>SUM(B2:B4)</f>");
    expect(cachedValue(data, "B8")).toBe(String(answer(7, 1)));
    const phuLuc = await sheetXml(engine, saved.bytes, "PhuLuc");
    expect(cachedValue(phuLuc, "B2")).toBe(String(answer(1, 1)));

    // Reopen: the snapshot keeps formulas (it exposes no cached value for them)
    // and the edited literals.
    const reopened = (await engine.readWorkbook(saved.bytes)).snapshot;
    const dataCells = reopened.sheets.find((s) => s.name === "Data")?.cells ?? {};
    expect(dataCells.B6?.formula).toBe("=SUM(B2:B4)");
    expect(dataCells.B8?.formula).toBe("=SUM(B2:B4)");
    expect(dataCells.B2?.value).toBe(1_570_000_000);
    expect(dataCells.B4?.value).toBe(2_000_000_000);
    expect(dataCells.A10?.value).toBe("ghi chú");
    expect(reopened.sheets.find((s) => s.name === "PhuLuc")?.cells.B2?.formula).toBe("=SUM(Data!B2:B4)");
    // The render model is what the editor paints on reopen: its formula cells
    // carry the refreshed cache, not the file's pre-save value.
    const render = await readXlsxRenderModel(engine, saved.bytes);
    const renderData = render.sheets.find((s) => s.name === "Data")?.cells ?? {};
    expect(renderData.B6?.c).toBe(answer(5, 1));
    expect(renderData.C6?.c).toBe(answer(5, 2));
    expect(renderData.B8?.c).toBe(answer(7, 1));
    expect(render.sheets.find((s) => s.name === "PhuLuc")?.cells.B2?.c).toBe(answer(1, 1));
  });

  it("gives a shifted formula the value of its NEW coordinate after insert_rows", async () => {
    const engine = await load();
    const recalc = answeringRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, fixture(KITCHEN_SINK));
    const saved = await save(adapter, ref, [
      { op: "insert_rows", target: { sheet: "Data" }, attributes: { index: 5, count: 1 } },
    ]);
    expect(recalc.calls.at(-1)?.edits).toEqual([]);
    const data = await sheetXml(engine, saved.bytes, "Data");
    expect(cellXml(data, "B7")).toContain("<f>SUM(B2:B4)</f>");
    expect(cachedValue(data, "B7")).toBe(String(answer(6, 1)));
    expect(cachedValue(data, "C7")).toBe(String(answer(6, 2)));
    expect(cellXml(data, "B6")).not.toContain("<f>");
    const reopened = (await engine.readWorkbook(saved.bytes)).snapshot;
    expect(reopened.sheets[0]?.cells.B7?.formula).toBe("=SUM(B2:B4)");
  });

  it("refreshes both saves of a chained session; the second takes the single pass", async () => {
    const engine = await load();
    const recalc = answeringRecalc(engine);
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, fixture(KITCHEN_SINK));
    const first = await save(adapter, ref, [
      { op: "add_sheet", attributes: { name: "Scratch" } },
      { op: "set_cell", target: { sheet: "Scratch", cell: "A1" }, attributes: { value: "x" } },
    ]);
    const firstData = await sheetXml(engine, first.bytes, "Data");
    expect(cachedValue(firstData, "B6")).toBe(String(answer(5, 1)));
    const callsAfterFirst = recalc.calls.length;

    const second = await save(adapter, ref, [
      { op: "set_cell", target: { sheet: "Data", cell: "B3" }, attributes: { value: 7 } },
    ]);
    expect(recalc.calls.length).toBeGreaterThan(callsAfterFirst);
    const secondCall = recalc.calls[callsAfterFirst];
    // Normal single pass: the pending edit rides the request and the bytes
    // are the first save's output.
    expect(secondCall?.edits).toHaveLength(1);
    expect(Array.from(secondCall!.bytes)).toEqual(Array.from(first.bytes));
    const secondData = await sheetXml(engine, second.bytes, "Data");
    expect(cachedValue(secondData, "B6")).toBe(String(answer(5, 1)));
    expect(cachedValue(await sheetXml(engine, second.bytes, "PhuLuc"), "B2")).toBe(String(answer(1, 1)));
    expect((await engine.readWorkbook(second.bytes)).snapshot.sheets[0]?.cells.B3?.value).toBe(7);
  });

  it("refuses an identity change on a formula workbook without a recalc port", async () => {
    const engine = await load();
    const adapter = createXlsxAdapter({ engine });
    const ref = await openSession(adapter, fixture(KITCHEN_SINK));
    await expect(save(adapter, ref, [{ op: "add_sheet", attributes: { name: "Scratch" } }])).rejects.toMatchObject({
      code: "unsupported_operation",
    });
  });

  it("saves an identity change on a formula-free workbook without a recalc port", async () => {
    const engine = await load();
    const adapter = createXlsxAdapter({ engine });
    const ref = await openSession(adapter, fixture(COMPAT_EDIT));
    const saved = await save(adapter, ref, [{ op: "add_sheet", attributes: { name: "Scratch" } }]);
    const names = (await engine.readWorkbook(saved.bytes)).snapshot.sheets.map((s) => s.name);
    expect(names).toEqual(["Data", "Scratch"]);
    expect(saved.warnings).toEqual([]);
  });

  it("keeps the file's cached value and warns when the engine leaves a formula unanswered", async () => {
    const engine = await load();
    const recalc = answeringRecalc(engine, new Set(["Data 5,1"]));
    const adapter = createXlsxAdapter({ engine, recalc });
    const ref = await openSession(adapter, fixture(KITCHEN_SINK));
    const saved = await save(adapter, ref, [{ op: "add_sheet", attributes: { name: "Scratch" } }]);
    expect(saved.warnings).toContainEqual(
      expect.objectContaining({ code: "formula_cache_kept", detail: expect.stringMatching(/^1 formula cell/) }),
    );
    const data = await sheetXml(engine, saved.bytes, "Data");
    expect(cachedValue(data, "B6")).toBe("4908000000");
    expect(cachedValue(data, "C6")).toBe(String(answer(5, 2)));
  });
});
