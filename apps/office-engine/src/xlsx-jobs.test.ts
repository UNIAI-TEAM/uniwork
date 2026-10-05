// G2-04 xlsx lane end-to-end through the real service: HTTP submit → worker
// process → handler → PUT to the grant's target. The gateway artifact is the
// real patched build (.go-tmp/office-upstream-build); the Rust sidecar is not
// staged in these tests, so formula-bearing saves must refuse typed — that IS
// the honest-native-path contract. Recalc-on-the-real-engine evidence lives
// in the container suite / g2-04 replay where the sidecar is built.
import { chmod, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findHandler } from "./worker/handlers.ts";
import type { RunMessage } from "./worker/protocol.ts";
import {
  errorCode,
  errorReason,
  makeJob,
  startHarness,
  submit,
  waitTerminal,
  type Harness,
  type JobSpec,
} from "../test/harness.ts";

const REPO = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const BUILT_GATEWAY = join(REPO, ".go-tmp", "office-upstream-build", "dist", "xlsx-gateway.mjs");
const FIXTURES = join(REPO, "docs", "office", "g0", "fixtures", "files", "sheets");
const xlsxFixture = async (name: string) => new Uint8Array(await readFile(join(FIXTURES, name)));

let h: Harness;
let assetsDir: string;
// The image stages gateway + sidecar under one dir (UNIWORK_XLSX_ASSETS);
// locally the gateway comes from the host's .go-tmp build and the sidecar may
// be absent — the real-native tests below are gated on it.
const ENV_ASSETS = process.env.UNIWORK_XLSX_ASSETS;
const SIDECAR_STAGED =
  !!ENV_ASSETS && existsSync(join(ENV_ASSETS, process.platform === "win32" ? "xlsx-sidecar.exe" : "xlsx-sidecar"));

beforeAll(async () => {
  if (!existsSync(BUILT_GATEWAY) && !ENV_ASSETS) return;
  assetsDir = await mkdtemp(join(tmpdir(), "uw-xlsx-assets-"));
  // The sandboxed worker reads assets under its slot uid, not the service's:
  // the staging dir must be traversable by it (0755) like the image's asset dir.
  await chmod(assetsDir, 0o755);
  await copyFile(ENV_ASSETS ? join(ENV_ASSETS, "xlsx-gateway.mjs") : BUILT_GATEWAY, join(assetsDir, "xlsx-gateway.mjs"));
  h = await startHarness({ xlsxAssetsDir: assetsDir });
});
afterAll(async () => {
  await h?.close();
  if (assetsDir) await rm(assetsDir, { recursive: true, force: true });
});

const xlsxJob = (target: Harness["target"], spec: Omit<JobSpec, "text">) =>
  makeJob(target, { format: "xlsx", ...spec });

describe.skipIf(!existsSync(BUILT_GATEWAY) && !ENV_ASSETS)("xlsx jobs through the service", () => {
  it("open:xlsx probes kitchen-sink into a document-model summary", async () => {
    const job = xlsxJob(h.target, {
      bytes: await xlsxFixture("xlsx-kitchen-sink.xlsx"),
      operation: "open",
      payload: { base_revision: 3, base_version_id: "ver-3" },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("completed");
    const probe = JSON.parse(h.target.uploads.at(-1)!.body.toString("utf8")) as {
      document_model: { sheetCount: number; sheetNames: string[]; formulaCellCount: number; preservedParts: string[] };
      snapshot: { revision: number; sheets: { id: string; name: string; cells: Record<string, { value: unknown; formula?: string }> }[] };
    };
    expect(probe.document_model.sheetCount).toBe(2);
    expect(probe.document_model.sheetNames).toEqual(["Data", "PhuLuc"]);
    expect(probe.document_model.formulaCellCount).toBe(4);
    expect(probe.document_model.preservedParts.some((p) => /chart/.test(p))).toBe(true);
    expect(probe.snapshot.sheets.map((sheet) => sheet.name)).toEqual(["Data", "PhuLuc"]);
    const formulaCount = probe.snapshot.sheets.reduce((total, sheet) => total + Object.values(sheet.cells).filter((cell) => cell.formula !== undefined).length, 0);
    expect(formulaCount).toBe(4);
  });

  it("serialize:xlsx passes committed bytes through with a preserved-parts warning", async () => {
    const input = await xlsxFixture("xlsx-kitchen-sink.xlsx");
    const job = xlsxJob(h.target, {
      bytes: input,
      operation: "serialize",
      payload: { document_model_ref: "ver-3" },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("completed");
    expect(new Uint8Array(h.target.uploads.at(-1)!.body)).toEqual(input);
    const warnings = (done.body.warnings ?? []) as { code: string }[];
    expect(warnings.some((w) => w.code === "parts_preserved_not_editable")).toBe(true);
  });

  it("edit:xlsx on a formula-free workbook completes without the sidecar", async () => {
    const job = xlsxJob(h.target, {
      bytes: await xlsxFixture("xlsx-compatibility-edit.xlsx"),
      operation: "edit",
      payload: {
        edits: [{ op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 42 } }],
      },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("completed");
    expect(h.target.uploads.at(-1)!.body.length).toBeGreaterThan(100);
  });

  it("edit:xlsx on a formula-bearing workbook refuses typed — no sidecar staged", async () => {
    const job = xlsxJob(h.target, {
      bytes: await xlsxFixture("xlsx-kitchen-sink.xlsx"),
      operation: "edit",
      payload: {
        edits: [{ op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 7 } }],
      },
    });
    const uploadsBefore = h.target.uploads.length;
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("failed");
    // Missing native binary = deployment problem, not an input fault.
    expect(errorCode(done)).toBe("engine_incompatible");
    expect(h.target.uploads.length).toBe(uploadsBefore);
  });

  it("edit:xlsx with a corrupt zip fails typed, original untouched", async () => {
    const job = xlsxJob(h.target, {
      bytes: new Uint8Array([0x50, 0x4b, 0x05, 0x06, 1, 2, 3]),
      operation: "edit",
      payload: { edits: [{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 1 } }] },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("failed");
    expect(errorCode(done)).toBe("engine_result_invalid");
  });

  it("an unbound xlsx op vocabulary fails as unsupported_operation", async () => {
    const job = xlsxJob(h.target, {
      bytes: await xlsxFixture("xlsx-compatibility-edit.xlsx"),
      operation: "edit",
      payload: { edits: [{ op: "insert_sheet", attributes: {} }] },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("failed");
    expect(errorCode(done)).toBe("unsupported_operation");
  });
});

// Real-native path: runs only where the sidecar binary is staged (the image's
// test stage, or a host with --with-native output). This is the AC-1 evidence
// that a formula-bearing edit recalculates on the Rust engine, not a stand-in.
describe.skipIf(!SIDECAR_STAGED)("xlsx jobs with the real Rust sidecar", () => {
  let hn: Harness;
  beforeAll(async () => {
    hn = await startHarness({ xlsxAssetsDir: ENV_ASSETS });
  });
  afterAll(async () => {
    await hn?.close();
  });

  interface GatewayModule {
    readBasicWorkbook(b: Uint8Array): Promise<{
      snapshot: { sheets: { name: string; cells: Record<string, { formula?: string; value?: unknown }> }[] };
    }>;
    createBufferEntrySource(b: Uint8Array): Promise<{ readText(p: string): Promise<string> }>;
  }
  const gateway = async () =>
    (await import(pathToFileURL(join(ENV_ASSETS!, "xlsx-gateway.mjs")).href)) as GatewayModule;

  // The independent oracle: readBasicWorkbook deliberately reports a formula
  // cell's cached value as null, so the recalc proof reads <v> straight out of
  // the worksheet XML the save published.
  async function worksheetXml(
    zip: { readText(p: string): Promise<string> },
    sheetName: string,
  ): Promise<string> {
    const wb = await zip.readText("xl/workbook.xml");
    const rels = await zip.readText("xl/_rels/workbook.xml.rels");
    const tag = new RegExp(`<sheet\\b[^>]*\\bname="${sheetName}"[^>]*>`).exec(wb)?.[0];
    const rid = /r:id="([^"]+)"/.exec(tag ?? "")?.[1];
    const target = new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`).exec(rels)?.[1];
    return zip.readText("xl/" + target);
  }
  // Read the formula-bearing <c> element at an address (a literal at the same
  // address, if any, has no <f>), so the oracle reads the recalculated <v>.
  const cellV = (xml: string, addr: string) =>
    [...xml.matchAll(new RegExp(`<c\\b[^>]*\\br="${addr}"[^>]*>([\\s\\S]*?)</c>`, "g"))]
      .map((m) => m[1] ?? "")
      .find((body) => /<f[ >]/.test(body))
      ?.match(/<v>([^<]+)<\/v>/)?.[1];

  it("edit:xlsx recalculates formulas on the real engine and refreshes <v>", async () => {
    // kitchen-sink: Data!B6 =SUM(B2:B4). Edit B2 → the service must write a
    // fresh cached value for the dependent formula cells (in-sheet B6 and the
    // cross-sheet PhuLuc!B2) and must not keep a stale file cache (F7).
    const job = xlsxJob(hn.target, {
      bytes: await xlsxFixture("xlsx-kitchen-sink.xlsx"),
      operation: "edit",
      payload: {
        edits: [{ op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 100 } }],
      },
    });
    await submit(hn, job);
    const done = await waitTerminal(hn, job, 60_000);
    expect(done.body.state).toBe("completed");
    const out = hn.target.uploads.at(-1)!.body;
    expect(out.length).toBeGreaterThan(100);
    const mod = await gateway();
    const wb = await mod.readBasicWorkbook(new Uint8Array(out));
    const data = wb.snapshot.sheets.find((s) => s.name === "Data")!;
    // The formula survived as a formula — never replaced by its displayed value.
    expect(data.cells["B6"]?.formula).toBe("=SUM(B2:B4)");
    expect(data.cells["B2"]?.value).toBe(100);
    const zip = await mod.createBufferEntrySource(new Uint8Array(out));
    const dataXml = await worksheetXml(zip, "Data");
    const phuLucXml = await worksheetXml(zip, "PhuLuc");
    // The in-sheet total and the cross-sheet cell both track the edit:
    // B2(100) + B3(1.41e9) + B4(1.57e9) = 2980000100; B3 counts 3 labels.
    expect(Number(cellV(dataXml, "B6"))).toBe(2980000100);
    expect(Number(cellV(phuLucXml, "B2"))).toBe(2980000100);
    expect(Number(cellV(phuLucXml, "B3"))).toBe(3);
    // The repaired fixture labels the row-6 cells B6/C6, so every formula has
    // a covered coordinate and the engine refreshes them all - no cell keeps
    // its file-cached <v> (F7).
    const warnings = (done.body.warnings ?? []) as { code: string }[];
    expect(warnings.some((w) => w.code === "formula_cache_kept")).toBe(false);
  });

  it("two consecutive edit saves chain: job2 recalculates on job1's output", async () => {
    const mod = await gateway();
    const one = xlsxJob(hn.target, {
      bytes: await xlsxFixture("xlsx-kitchen-sink.xlsx"),
      operation: "edit",
      payload: { edits: [{ op: "set_cell", target: { sheet: "Data", cell: "B2" }, attributes: { value: 10 } }] },
    });
    await submit(hn, one);
    expect((await waitTerminal(hn, one, 60_000)).body.state).toBe("completed");
    const out1 = hn.target.uploads.at(-1)!.body;
    // Save 2 takes save 1's published bytes as input — the checksum/session
    // rebase path exercised end-to-end across jobs.
    const two = xlsxJob(hn.target, {
      bytes: new Uint8Array(out1),
      operation: "edit",
      payload: { edits: [{ op: "set_cell", target: { sheet: "Data", cell: "B3" }, attributes: { value: 20 } }] },
    });
    await submit(hn, two);
    expect((await waitTerminal(hn, two, 60_000)).body.state).toBe("completed");
    const wb = await mod.readBasicWorkbook(new Uint8Array(hn.target.uploads.at(-1)!.body));
    const data = wb.snapshot.sheets.find((s) => s.name === "Data")!;
    expect(data.cells["B6"]?.formula).toBe("=SUM(B2:B4)");
    const zip = await mod.createBufferEntrySource(new Uint8Array(hn.target.uploads.at(-1)!.body));
    const dataXml = await worksheetXml(zip, "Data");
    const phuLucXml = await worksheetXml(zip, "PhuLuc");
    // Job 2 recalculated over job 1's published bytes: B6 and PhuLuc!B2
    // both equal B2(10)+B3(20)+B4(1.57e9).
    expect(Number(cellV(dataXml, "B6"))).toBe(10 + 20 + 1570000000);
    expect(Number(cellV(phuLucXml, "B2"))).toBe(10 + 20 + 1570000000);
  });
});

describe("xlsx handlers (file seam)", () => {
  it("edit:xlsx fails typed when ops.json is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uw-xlsx-handler-"));
    try {
      await copyFile(join(FIXTURES, "xlsx-compatibility-edit.xlsx"), join(dir, "input.bin"));
      const handler = findHandler("edit", "xlsx")!;
      const message: RunMessage = {
        type: "run",
        operation: "edit",
        format: "xlsx",
        inputPath: join(dir, "input.bin"),
        outputPath: join(dir, "output.bin"),
        payloadPath: null,
        tempDir: dir,
        sampleMs: 50,
        heapMb: 256,
        faults: false,
      };
      const outcome = await handler(message);
      expect(outcome).toMatchObject({ ok: false, code: "engine_result_invalid", reason: "ops_payload_missing" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("xlsx ops are bound beside the pdf lane", () => {
    expect(findHandler("open", "xlsx")).toBeTypeOf("function");
    expect(findHandler("serialize", "xlsx")).toBeTypeOf("function");
    expect(findHandler("edit", "xlsx")).toBeTypeOf("function");
  });
});
