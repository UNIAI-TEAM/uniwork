// Width-less <col> saves through the REAL patched gateway AND the REAL Rust
// recalc sidecar (UNI-953 column-group save, patch 0017). The gateway writes a
// grouped, hidden or style-only column with no `width`; IronCalc's import
// required one, so every such save of a formula workbook failed with
// engine_result_invalid. The other structural tests drive a fake recalc port,
// which never parses the package, so they could not see it.
//
// Needs the gateway bundle and the sidecar binary that
// `node scripts/office/build-upstream.mjs --with-native` builds into
// .go-tmp/office-upstream-build. Without the binary the suite skips with a
// warning; REQUIRE_XLSX_SIDECAR=1 fails instead (CI builds no native sidecar).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bindXlsxGateway, createXlsxAdapter, readXlsxRenderModel } from "../src/xlsx";
import { createXlsxSidecar } from "../src/node/xlsx-sidecar";
import { ARTIFACT } from "./xlsx-patched-gateway";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const SIDECAR = join(REPO, ".go-tmp", "office-upstream-build", "native", process.platform === "win32" ? "xlsx-sidecar.exe" : "xlsx-sidecar");
const KITCHEN_SINK = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets", "xlsx-kitchen-sink.xlsx");
const WIDTHLESS = join(HERE, "fixtures", "widthless-cols", "xlsx-widthless-cols.xlsx");

type Gateway = ReturnType<typeof bindXlsxGateway>;
const load = async (): Promise<Gateway> => bindXlsxGateway((await import(pathToFileURL(ARTIFACT).href)) as never);
const op = (name: string, attributes: Record<string, unknown>) => ({ op: name, target: { sheet: "Data" }, attributes });

/** Open `bytes`, apply `ops`, save with the real sidecar as the recalc port. */
async function savedWithSidecar(engine: Gateway, bytes: Uint8Array, ops: readonly Record<string, unknown>[]) {
  // No workDir: the client stages in its own temp dir and removes it on
  // close(), after the child has exited.
  const recalc = createXlsxSidecar({ binaryPath: SIDECAR });
  try {
    const adapter = createXlsxAdapter({ engine, recalc });
    const opened = await adapter.open({ bytes, format: "xlsx", document_id: "widthless-cols" });
    if (opened.outcome !== "opened") throw new Error("fixture_open_failed");
    adapter.edit(opened.document_model_ref, ops);
    const saved = await adapter.serialize({ document_model_ref: opened.document_model_ref, format: "xlsx" });
    adapter.release(opened.document_model_ref);
    return saved;
  } finally {
    await recalc.close();
  }
}

/** Sheet Data as the editor paints it on reopen: column spans, and formula
 *  cells carrying the cache the save's recalc wrote. */
async function reopenedData(engine: Gateway, bytes: Uint8Array) {
  const data = (await readXlsxRenderModel(engine, bytes)).sheets.find((sheet) => sheet.name === "Data");
  if (!data) throw new Error("Data sheet missing");
  return {
    column: (column: number) => data.columnWidths.find((span) => span.startColumn <= column && column <= span.endColumn),
    cached: (cell: string) => data.cells[cell]?.c,
  };
}

function describeWithSidecar(name: string, body: () => void): void {
  if (existsSync(ARTIFACT) && existsSync(SIDECAR)) {
    describe(name, body);
  } else if (process.env.REQUIRE_XLSX_SIDECAR === "1") {
    describe(name, () => {
      it("needs the gateway bundle and the sidecar binary when REQUIRE_XLSX_SIDECAR=1", () => {
        throw new Error("run node scripts/office/build-upstream.mjs --with-native to build the gateway bundle and the xlsx sidecar");
      });
    });
  } else {
    console.warn(`${name}: skipping (no gateway bundle or sidecar binary; build-upstream --with-native, or REQUIRE_XLSX_SIDECAR=1 to fail)`);
    describe.skip(name, body);
  }
}

describeWithSidecar("width-less columns save through the real recalc sidecar", () => {
  it("a column group with Hide Detail saves and reopens with its outline level and collapsed flag", async () => {
    const engine = await load();
    const saved = await savedWithSidecar(engine, new Uint8Array(readFileSync(KITCHEN_SINK)), [
      op("set_cols_outline", { start: 1, end: 2, level: 1 }),
      op("set_cols_hidden", { start: 1, end: 2, hidden: true }),
      op("set_cols_outline", { start: 3, end: 3, level: 0, collapsed: true }),
    ]);
    const { column, cached } = await reopenedData(engine, saved.bytes);
    expect([column(1)?.outlineLevel, column(2)?.outlineLevel]).toEqual([1, 1]);
    expect([column(1)?.hidden, column(2)?.hidden]).toEqual([true, true]);
    expect(column(3)?.collapsed).toBe(true);
    // The recalc answered, and the gateway still writes no width it was not given.
    expect(saved.warnings ?? []).toEqual([]);
    const xml = (await engine.readEntryText(saved.bytes, "xl/worksheets/sheet1.xml")) ?? "";
    expect(xml).toMatch(/<col min="2" max="3"(?![^>]*\bwidth=)[^>]*outlineLevel="1"[^>]*\/>/);
    expect(xml).toContain('outlineLevelCol="1"');
    expect(cached("B6")).toBe(4_230_000_000);
  });

  it("a group alone (the live repro: Nhóm cột on B:C, then Save) saves", async () => {
    const engine = await load();
    const saved = await savedWithSidecar(engine, new Uint8Array(readFileSync(KITCHEN_SINK)), [
      op("set_cols_outline", { start: 1, end: 2, level: 1 }),
    ]);
    const { column } = await reopenedData(engine, saved.bytes);
    expect([column(0)?.outlineLevel ?? 0, column(1)?.outlineLevel, column(2)?.outlineLevel]).toEqual([0, 1, 1]);
  });

  it("hiding a column on a formula sheet saves", async () => {
    const engine = await load();
    const saved = await savedWithSidecar(engine, new Uint8Array(readFileSync(KITCHEN_SINK)), [
      op("set_cols_hidden", { start: 2, end: 2, hidden: true }),
    ]);
    const { column, cached } = await reopenedData(engine, saved.bytes);
    expect(column(2)?.hidden).toBe(true);
    expect(cached("C6")).toBe(2_460_000_000);
  });

  it("a third-party package with a width-less <col> takes a formula edit and keeps its column bytes", async () => {
    const engine = await load();
    const source = new Uint8Array(readFileSync(WIDTHLESS));
    const saved = await savedWithSidecar(engine, source, [
      { op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 1_000_000_000 } },
    ]);
    // B6 = SUM(B2:B4): 1.0e9 + 1.41e9 + 1.57e9, recomputed by the sidecar.
    expect((await reopenedData(engine, saved.bytes)).cached("B6")).toBe(3_980_000_000);
    const xml = (await engine.readEntryText(saved.bytes, "xl/worksheets/sheet1.xml")) ?? "";
    expect(xml).toContain('<cols><col min="2" max="3" style="0"/></cols>');
  });
});
