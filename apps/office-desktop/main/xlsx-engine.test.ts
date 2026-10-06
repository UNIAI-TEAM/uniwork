import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import type { XlsxCellState, XlsxGatewayFunctions, XlsxRecalcEdit, XlsxRecalcPort, XlsxRecalcRead } from "@uniwork/office-engine/xlsx";
import { createLocalXlsxEngine, PACKAGED_XLSX_ASSETS_DIRECTORY, resolveLocalXlsxAssetsDir } from "./xlsx-engine";

// R3-2 (DESKTOP-XLSX): the packaged win-unpacked build shipped no xlsx assets,
// so a local .xlsx open died with EngineBoundaryError: engine_incompatible.
// The packaged build now stages resources/xlsx-assets and the main process
// resolves it from process.resourcesPath - NOT an env var the user must set.

const roots: string[] = [];
function resourcesWithStagedAssets(): string {
  const root = mkdtempSync(join(tmpdir(), "uniwork-xlsx-resources-"));
  roots.push(root);
  mkdirSync(join(root, PACKAGED_XLSX_ASSETS_DIRECTORY), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveLocalXlsxAssetsDir", () => {
  it("resolves the staged packaged dir from the Electron resources path with no env var", () => {
    const resourcesPath = resourcesWithStagedAssets();
    expect(resolveLocalXlsxAssetsDir({ resourcesPath, envAssetsDir: undefined })).toBe(join(resourcesPath, PACKAGED_XLSX_ASSETS_DIRECTORY));
  });

  it("lets an explicit dev dir (UNIWORK_XLSX_ASSETS) win over the packaged dir", () => {
    const resourcesPath = resourcesWithStagedAssets();
    expect(resolveLocalXlsxAssetsDir({ resourcesPath, envAssetsDir: "D:/dev/xlsx-assets" })).toBe("D:/dev/xlsx-assets");
  });

  it("treats a blank env value as unset", () => {
    const resourcesPath = resourcesWithStagedAssets();
    expect(resolveLocalXlsxAssetsDir({ resourcesPath, envAssetsDir: "   " })).toBe(join(resourcesPath, PACKAGED_XLSX_ASSETS_DIRECTORY));
  });

  it("returns undefined when nothing was staged, so the engine reports its typed failure", () => {
    const empty = mkdtempSync(join(tmpdir(), "uniwork-xlsx-empty-"));
    roots.push(empty);
    expect(resolveLocalXlsxAssetsDir({ resourcesPath: empty, envAssetsDir: undefined })).toBeUndefined();
  });

  // The unpackaged dev run (electron <app>) has no resources/xlsx-assets, so a
  // signed-out local .xlsx open failed with engine_incompatible even though
  // the build had the gateway to hand. The dev bundle stages dist/xlsx-assets
  // (the same dir package.mjs stages from) and main resolves it from there.
  it("resolves the dev bundle's dist/xlsx-assets for an unpackaged run", () => {
    const distDirectory = resourcesWithStagedAssets();
    expect(resolveLocalXlsxAssetsDir({ resourcesPath: undefined, distDirectory, envAssetsDir: undefined })).toBe(join(distDirectory, PACKAGED_XLSX_ASSETS_DIRECTORY));
  });

  it("prefers the packaged resources dir over a dist dir", () => {
    const resourcesPath = resourcesWithStagedAssets();
    const distDirectory = resourcesWithStagedAssets();
    expect(resolveLocalXlsxAssetsDir({ resourcesPath, distDirectory, envAssetsDir: undefined })).toBe(join(resourcesPath, PACKAGED_XLSX_ASSETS_DIRECTORY));
  });

  it("returns undefined for an unpackaged run with no explicit dir", () => {
    expect(resolveLocalXlsxAssetsDir({ resourcesPath: undefined, envAssetsDir: undefined })).toBeUndefined();
    expect(resolveLocalXlsxAssetsDir()).toBeUndefined();
  });
});

// R4B-1: the adapter closes its recalc port terminally when a job's last
// session ends (the port is per-job). The desktop engine cached one sidecar
// port for the whole app session, so every Save after the first reused a
// closed port and failed with engine_crashed. Each edit job must get a fresh
// port, close it afterwards, and a broken port must not poison the next job.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

interface FakePackage { sheets: { id: string; name: string; cells: Record<string, XlsxCellState> }[] }

function encodePackage(pkg: FakePackage): Uint8Array {
  const payload = encoder.encode(JSON.stringify(pkg));
  const out = new Uint8Array(ZIP_MAGIC.length + payload.length);
  out.set(ZIP_MAGIC);
  out.set(payload, ZIP_MAGIC.length);
  return out;
}
const decodePackage = (bytes: Uint8Array): FakePackage => JSON.parse(decoder.decode(bytes.subarray(ZIP_MAGIC.length))) as FakePackage;
const a1 = (row: number, column: number) => String.fromCharCode(65 + column) + String(row + 1);

/** A formula-bearing workbook: its save must drive the recalc port. */
const FORMULA_WORKBOOK = encodePackage({ sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 1 }, B1: { value: 2, formula: "=A1*2" } } }] });
const SET_A1 = [{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 5 } }];

/** Minimal gateway over the JSON convention above: enough of the seam for the
 *  adapter's open -> edit -> recalc -> assemble path. */
function fakeGateway(): XlsxGatewayFunctions {
  const inventory = async (bytes: Uint8Array) =>
    ["[Content_Types].xml", "xl/workbook.xml", ...decodePackage(bytes).sheets.map((s) => `xl/worksheets/${s.id}.xml`)].map((path) => ({ path, size: 1, sha256: "sha-" + path }));
  return {
    async readWorkbook(bytes) {
      const pkg = decodePackage(bytes);
      return { snapshot: { revision: 0, sheets: pkg.sheets }, sheetNamesById: Object.fromEntries(pkg.sheets.map((s) => [s.id, s.name])) };
    },
    inventory,
    async readEntryText(_bytes, path) { return path.endsWith(".xml") ? "<xml/>" : null; },
    async readEntriesText(_bytes, paths) { return Object.fromEntries(paths.map((path) => [path, path.endsWith(".xml") ? "<xml/>" : null])); },
    async applyCellEdits(source, edits, formulaValues = []) {
      const pkg = decodePackage(source);
      for (const edit of edits) {
        const sheet = pkg.sheets.find((s) => s.name === edit.sheetName)!;
        if (edit.writeValue) sheet.cells[a1(edit.row, edit.column)] = edit.cell;
      }
      for (const values of formulaValues) {
        const sheet = pkg.sheets.find((s) => s.name === values.sheetName)!;
        for (const cell of values.cells) {
          const current = sheet.cells[a1(cell.row, cell.column)];
          if (current?.formula !== undefined) sheet.cells[a1(cell.row, cell.column)] = { ...current, value: typeof cell.value === "object" && cell.value !== null ? cell.value.error : cell.value };
        }
      }
      const buffer = encodePackage(pkg);
      return { buffer, touchedEntries: pkg.sheets.map((s) => `xl/worksheets/${s.id}.xml`), removedEntries: [], addedEntries: [], beforeEntries: [...(await inventory(source))], afterEntries: [...(await inventory(buffer))] };
    },
    assertPreserved() {},
  };
}

/** A recalc port with the real sidecar's lifecycle: close() is terminal and a
 *  recalc after it fails the way XlsxSidecar.ensure() does. */
function terminalPort(options: { crash?: boolean } = {}): XlsxRecalcPort & { closed: boolean; recalcs: number } {
  const port = {
    closed: false,
    recalcs: 0,
    async recalc(_bytes: Uint8Array, _edits: readonly XlsxRecalcEdit[], reads: readonly XlsxRecalcRead[]) {
      if (port.closed) throw new EngineBoundaryError("engine_crashed", { detail: "xlsx sidecar released" });
      if (options.crash) throw new EngineBoundaryError("engine_crashed", { detail: "xlsx sidecar process error" });
      port.recalcs += 1;
      return { cells: reads.map((read) => ({ sheet: read.sheet, row: 0, column: 1, formatted: "10", number: 10, isError: false, isFormula: true })) };
    },
    async close() { port.closed = true; },
  };
  return port;
}

describe("createLocalXlsxEngine recalc port lifecycle (R4B-1)", () => {
  it("saves twice in one app session, each job on a fresh port that is closed afterwards", async () => {
    const ports: ReturnType<typeof terminalPort>[] = [];
    const engine = createLocalXlsxEngine({ engine: fakeGateway(), createRecalc: () => { const port = terminalPort(); ports.push(port); return port; } });

    const first = await engine.edit(FORMULA_WORKBOOK, SET_A1);
    const second = await engine.edit(first.bytes, SET_A1);

    expect(decodePackage(second.bytes).sheets[0]!.cells.B1).toMatchObject({ formula: "=A1*2", value: 10 });
    expect(second.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ports).toHaveLength(2);
    expect(ports[0]).not.toBe(ports[1]);
    expect(ports.map((port) => port.recalcs)).toEqual([1, 1]);
    // No leaked sidecar: every port the engine created was closed.
    expect(ports.every((port) => port.closed)).toBe(true);
  });

  it("does not let a crashed port on job 1 break job 2", async () => {
    const ports: ReturnType<typeof terminalPort>[] = [];
    const engine = createLocalXlsxEngine({ engine: fakeGateway(), createRecalc: () => { const port = terminalPort({ crash: ports.length === 0 }); ports.push(port); return port; } });

    await expect(engine.edit(FORMULA_WORKBOOK, SET_A1)).rejects.toMatchObject({ code: "engine_crashed" });
    await expect(engine.edit(FORMULA_WORKBOOK, SET_A1)).resolves.toMatchObject({ checksum: expect.stringMatching(/^sha256:/) });
    expect(ports).toHaveLength(2);
    expect(ports.every((port) => port.closed)).toBe(true);
  });

  it("closes the job's port when the input fails to open, and the next job still works", async () => {
    const ports: ReturnType<typeof terminalPort>[] = [];
    const engine = createLocalXlsxEngine({ engine: fakeGateway(), createRecalc: () => { const port = terminalPort(); ports.push(port); return port; } });

    // Not a zip package: adapter.open fails, so the adapter's release() never
    // runs and the engine's finally is the only reaper of this job's port.
    await expect(engine.edit(new TextEncoder().encode("not an xlsx package"), SET_A1)).rejects.toMatchObject({ code: "engine_result_invalid" });
    expect(ports).toHaveLength(1);
    expect(ports[0]!.recalcs).toBe(0);
    expect(ports[0]!.closed).toBe(true);

    await expect(engine.edit(FORMULA_WORKBOOK, SET_A1)).resolves.toMatchObject({ checksum: expect.stringMatching(/^sha256:/) });
    expect(ports).toHaveLength(2);
    expect(ports[1]!.closed).toBe(true);
  });

  it("retries a failed port creation on the next job instead of caching the failure", async () => {
    let attempts = 0;
    const ports: ReturnType<typeof terminalPort>[] = [];
    const engine = createLocalXlsxEngine({
      engine: fakeGateway(),
      createRecalc: () => {
        attempts += 1;
        if (attempts === 1) throw new EngineBoundaryError("engine_incompatible", { detail: "xlsx sidecar binary not staged" });
        const port = terminalPort();
        ports.push(port);
        return port;
      },
    });

    // No sidecar fails closed for a formula-bearing save, and says why: the
    // code rides the error MESSAGE because Electron's invoke rejection keeps
    // only the message, so a bare unsupported_operation reached the renderer
    // as office_unknown_error ...
    await expect(engine.edit(FORMULA_WORKBOOK, SET_A1)).rejects.toMatchObject({ code: "xlsx_recalc_unavailable", message: expect.stringContaining("xlsx_recalc_unavailable") });
    // ... and the next job spawns again rather than inheriting the failure.
    await expect(engine.edit(FORMULA_WORKBOOK, SET_A1)).resolves.toMatchObject({ checksum: expect.stringMatching(/^sha256:/) });
    expect(attempts).toBe(2);
    expect(ports.every((port) => port.closed)).toBe(true);
  });

  it("still completes a formula-free edit when no sidecar can be created", async () => {
    const plain = encodePackage({ sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 1 } } }] });
    const engine = createLocalXlsxEngine({ engine: fakeGateway(), createRecalc: () => { throw new EngineBoundaryError("engine_incompatible", { detail: "missing" }); } });

    const saved = await engine.edit(plain, SET_A1);
    expect(decodePackage(saved.bytes).sheets[0]!.cells.A1).toMatchObject({ value: 5 });
  });
});

// A local workbook is not size-capped: the server contract bounds (64 MiB in,
// 128 MiB out) are lifted for the desktop engine. JSON tolerates trailing
// whitespace, so padding the fake package makes it arbitrarily large.
describe("createLocalXlsxEngine byte bounds", () => {
  const padded = (size: number): Uint8Array => {
    const base = encodePackage({ sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 1 } } }] });
    const out = new Uint8Array(size).fill(0x20);
    out.set(base);
    return out;
  };

  it("opens and edits a workbook above the 64 MiB server input bound", async () => {
    const big = padded(130 * 1024 * 1024);
    const engine = createLocalXlsxEngine({ engine: fakeGateway(), createRecalc: () => terminalPort() });
    await expect(engine.open(big)).resolves.toMatchObject({ snapshot: { sheets: [{ name: "Data" }] } });
    const edited = await engine.edit(big, SET_A1);
    expect(decodePackage(edited.bytes).sheets[0]!.cells.A1).toMatchObject({ value: 5 });
  }, 60_000);
});
