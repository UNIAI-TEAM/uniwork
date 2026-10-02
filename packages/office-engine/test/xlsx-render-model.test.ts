// G3-05c render-model reader tests. The gateway bundle is built here (test
// scope) because the service artifact set is produced by the Docker build,
// not by the repository prepare step; the same source + patches feed it.
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bindXlsxGateway, readXlsxRenderModel, renderModelCellCount, type XlsxGatewayFunctions, type XlsxRenderModel } from "../src/xlsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");
const UPSTREAM = join(REPO, "packages", "office-upstream", "upstream");
const GATEWAY_ENTRY = join(UPSTREAM, "packages", "xlsx-gateway", "src", "gateway", "xlsx-gateway.ts");
const TEST_DIST = join(REPO, ".go-tmp", "xlsx-gateway-test", "dist", "xlsx-gateway.mjs");
// The run folder sits three levels above the worktree (worktrees/dev-uniwork/<lane>).
const D3_FIXTURES = join(REPO, "..", "..", "..", "office-g3g4", "reports", "g3-d3-xlsx", "fixtures");

let engine: XlsxGatewayFunctions;

beforeAll(async () => {
  if (!existsSync(TEST_DIST)) {
    const require = createRequire(join(REPO, "package.json"));
    const esbuild = require("esbuild") as { build(options: Record<string, unknown>): Promise<unknown> };
    mkdirSync(dirname(TEST_DIST), { recursive: true });
    await esbuild.build({
      absWorkingDir: UPSTREAM,
      entryPoints: [GATEWAY_ENTRY],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      outfile: TEST_DIST,
      nodePaths: [join(REPO, "packages", "office-upstream", "node_modules")],
      logLevel: "silent",
    });
  }
  const mod = await import(pathToFileURL(TEST_DIST).href);
  engine = bindXlsxGateway(mod as never);
});

const readFixture = async (name: string): Promise<{ model: XlsxRenderModel; snapshotSheets: { name: string; cells: Record<string, unknown> }[] }> => {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));
  const imported = await engine.readWorkbook(bytes);
  const model = await readXlsxRenderModel(engine, bytes);
  return { model, snapshotSheets: imported.snapshot.sheets as never };
};

describe("xlsx render model reader", () => {
  it("keeps every basic-read cell and materialises the cached formula results", async () => {
    const { model, snapshotSheets } = await readFixture("xlsx-kitchen-sink.xlsx");
    expect(model.sheets.map((sheet) => sheet.name)).toEqual(snapshotSheets.map((sheet) => sheet.name));
    let formulaCells = 0;
    for (const snapshotSheet of snapshotSheets) {
      const renderSheet = model.sheets.find((sheet) => sheet.name === snapshotSheet.name)!;
      expect(renderSheet).toBeDefined();
      for (const [address, state] of Object.entries(snapshotSheet.cells as Record<string, { value: unknown; formula?: string }>)) {
        const cell = renderSheet.cells[address];
        if (!cell) throw new Error(`missing render cell ${snapshotSheet.name}!${address}`);
        if (state.formula !== undefined) {
          expect(cell.f).toBe(state.formula);
          // The basic read drops the cached <v>; the render model keeps it.
          expect(cell.c).toBeDefined();
          formulaCells += 1;
        } else {
          expect(cell.v).toEqual(state.value);
        }
      }
    }
    expect(formulaCells).toBeGreaterThan(0);
  });

  it("reads styles, theme-free defaults and the active tab", async () => {
    const { model } = await readFixture("xlsx-vietnamese.xlsx");
    expect(model.styles.length).toBeGreaterThan(0);
    const first = model.styles[0]!;
    expect(first.fontFamily).toBe("Calibri");
    expect(typeof first.bold).toBe("boolean");
    expect(first.diagonalUp).toBe(false);
    expect(model.activeTab).toBe(0);
    expect(model.date1904).toBe(false);
    const styled = model.sheets.flatMap((sheet) => Object.values(sheet.cells)).filter((cell) => cell.s !== undefined);
    expect(styled.length).toBeGreaterThan(0);
  });

  it("counts cells for the payload bound", async () => {
    const { model } = await readFixture("xlsx-kitchen-sink.xlsx");
    expect(renderModelCellCount(model)).toBeGreaterThan(0);
  });
});

const d3 = (name: string) => join(D3_FIXTURES, name);
describe.skipIf(!existsSync(d3("features.xlsx")))("xlsx render model reader on the G3-D3 corpus", () => {
  it("features.xlsx carries merges, custom widths/heights and a frozen pane", async () => {
    const bytes = new Uint8Array(readFileSync(d3("features.xlsx")));
    const model = await readXlsxRenderModel(engine, bytes);
    const baoCao = model.sheets.find((sheet) => sheet.name === "Bao cao")!;
    expect(baoCao).toBeDefined();
    expect(baoCao.merges.length).toBeGreaterThanOrEqual(2);
    expect(baoCao.columnWidths.filter((column) => column.width !== undefined).length).toBeGreaterThanOrEqual(6);
    expect(baoCao.rowsMeta.filter((row) => row.height !== undefined).length).toBeGreaterThanOrEqual(3);
    expect(baoCao.freeze).toEqual({ frozenRows: 2, frozenColumns: 2 });
    const numberFormats = model.styles.filter((style) => style.numberFormat !== undefined);
    expect(numberFormats.length).toBeGreaterThan(0);
  });

  it("styled2000.xlsx keeps the styles referenced by cells", async () => {
    const bytes = new Uint8Array(readFileSync(d3("styled2000.xlsx")));
    const model = await readXlsxRenderModel(engine, bytes);
    const sheet = model.sheets[0]!;
    const styledCells = Object.values(sheet.cells).filter((cell) => cell.s !== undefined);
    expect(styledCells.length).toBeGreaterThan(1000);
    for (const cell of styledCells.slice(0, 50)) {
      expect(model.styles[cell.s!]).toBeDefined();
    }
  });

  it("large.xlsx reads 20k x 10 rows within the open bound", async () => {
    const bytes = new Uint8Array(readFileSync(d3("large.xlsx")));
    const started = Date.now();
    const model = await readXlsxRenderModel(engine, bytes);
    const elapsed = Date.now() - started;
    const sheet = model.sheets[0]!;
    expect(Object.keys(sheet.cells).length).toBeGreaterThan(199_000);
    expect(sheet.rowCount).toBeGreaterThanOrEqual(20_000);
    // Sanity bound for the service open job; the real budget is measured in
    // AC-5, this only catches a pathological regression.
    expect(elapsed).toBeLessThan(60_000);
  });
});
