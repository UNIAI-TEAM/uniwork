// export:docx renderer (UNI-1013). The CDP driver runs against a fake
// Chromium - a Node script that speaks the --remote-debugging-pipe framing and
// plays the renderer's side of the print calls - so every path is pinned
// without a browser. With UNIWORK_DOCS_PDF_TEST_ASSETS pointing at a staged
// assets dir (bundle/ + chromium) the last test renders a real fixture.

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { DocsPdfError, PAGE_SHIM, printParams, renderDocxPdf, resolveBundlePath, serveBundle, type DocsPdfOptions } from "./docs-pdf.ts";
import { findHandler } from "./handlers.ts";
import type { RunMessage } from "./protocol.ts";

// The fake browser: answers every command, and on Page.navigate plays the
// script in FAKE_PLAN (print calls the page would make, then the done report).
const FAKE_CHROMIUM = `#!/usr/bin/env node
const fs = require('node:fs');
const plan = JSON.parse(process.env.FAKE_PLAN || '[]');
const out = fs.createWriteStream(null, { fd: 4 });
const send = (m) => out.write(JSON.stringify(m) + '\\0');
let buf = '';
let step = 0;
const bind = (payload) => send({ method: 'Runtime.bindingCalled', sessionId: 'S1', params: { name: '__uePdf', payload: JSON.stringify(payload) } });
const advance = () => { const next = plan[step++]; if (next) bind(next); };
fs.createReadStream(null, { fd: 3 }).on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let end;
  while ((end = buf.indexOf('\\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, end));
    buf = buf.slice(end + 1);
    if (process.env.FAKE_MODE === 'exit') process.exit(3);
    if (msg.method === 'Target.createTarget') send({ id: msg.id, result: { targetId: 'T1' } });
    else if (msg.method === 'Target.attachToTarget') send({ id: msg.id, result: { sessionId: 'S1' } });
    else if (msg.method === 'Page.printToPDF') {
      if (process.env.FAKE_MODE === 'cdp_error') send({ id: msg.id, error: { message: 'print failed' } });
      else send({ id: msg.id, result: { data: Buffer.from('%PDF-' + msg.params.paperWidth + 'x' + msg.params.paperHeight).toString('base64') } });
    } else if (msg.method === 'Page.navigate') {
      send({ id: msg.id, result: {} });
      if (process.env.FAKE_MODE !== 'hang') { send('not json'); advance(); }
    } else if (msg.method === 'Runtime.evaluate') { send({ id: msg.id, result: {} }); advance(); }
    else send({ id: msg.id, result: {} });
  }
});
`;

let dir: string;
let opts: DocsPdfOptions;
const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const concat = async (parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "uw-docs-pdf-"));
  await mkdir(join(dir, "bundle"));
  await writeFile(join(dir, "bundle", "index.html"), "<!doctype html>");
  await writeFile(join(dir, "chromium"), FAKE_CHROMIUM);
  await chmod(join(dir, "chromium"), 0o755);
  opts = { chromiumPath: join(dir, "chromium"), bundleDir: join(dir, "bundle"), profileDir: join(dir, "profile"), timeoutMs: 10_000 };
  delete process.env.FAKE_PLAN;
  delete process.env.FAKE_MODE;
});

afterEach(async () => {
  delete process.env.FAKE_PLAN;
  delete process.env.FAKE_MODE;
  await rm(dir, { recursive: true, force: true });
});

const plan = (steps: unknown[]) => {
  process.env.FAKE_PLAN = JSON.stringify(steps);
};

describe("printParams", () => {
  it("maps twips to inches with zero margins, as desktop main does", () => {
    expect(printParams(11906, 16838)).toEqual({
      paperWidth: 11906 / 1440,
      paperHeight: 16838 / 1440,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      printBackground: true,
      preferCSSPageSize: false,
    });
  });

  it("passes a non-unit scale and drops 1 or nonsense", () => {
    expect(printParams(12240, 15840, 0.9).scale).toBe(0.9);
    expect(printParams(12240, 15840, 1)).not.toHaveProperty("scale");
    expect(printParams(12240, 15840, -2)).not.toHaveProperty("scale");
  });

  it("refuses a page without a size", () => {
    expect(() => printParams(0, 15840)).toThrow(DocsPdfError);
  });
});

describe("resolveBundlePath", () => {
  it("keeps paths inside the bundle and maps / to index.html", () => {
    expect(resolveBundlePath("/b", "/")).toBe(resolve("/b/index.html"));
    expect(resolveBundlePath("/b", "/assets/a%20b.js")).toBe(resolve("/b/assets/a b.js"));
  });

  it("refuses traversal, NUL and broken escapes", () => {
    expect(resolveBundlePath("/b", "/../etc/passwd")).toBeNull();
    expect(resolveBundlePath("/b", "/%2e%2e/secret")).toBeNull();
    expect(resolveBundlePath("/b", "/a%00b")).toBeNull();
    expect(resolveBundlePath("/b", "/%E0%A4%A")).toBeNull();
  });
});

describe("serveBundle", () => {
  it("serves the bundle and the one input on loopback, and nothing else", async () => {
    await writeFile(join(dir, "bundle", "app.js"), "export {}");
    const server = await serveBundle(join(dir, "bundle"), docx);
    const { address, port } = server.address() as AddressInfo;
    expect(address).toBe("127.0.0.1");
    const base = `http://127.0.0.1:${port}`;
    try {
      const index = await fetch(base + "/");
      expect(index.status).toBe(200);
      expect(index.headers.get("content-type")).toContain("text/html");
      expect(index.headers.get("cache-control")).toBe("no-store");
      const script = await fetch(base + "/app.js");
      expect(script.headers.get("content-type")).toContain("text/javascript");
      const input = await fetch(base + "/__input.docx");
      expect(input.headers.get("content-type")).toContain("wordprocessingml");
      expect(new Uint8Array(await input.arrayBuffer())).toEqual(docx);
      expect((await fetch(base + "/missing.js")).status).toBe(404);
      expect((await fetch(base + "/%2e%2e/chromium")).status).toBe(404);
      expect((await fetch(base + "/app.js", { method: "POST" })).status).toBe(405);
    } finally {
      server.close();
    }
  });
});

describe("PAGE_SHIM", () => {
  it("is a self-contained script", () => {
    expect(() => new Function(PAGE_SHIM)).not.toThrow();
  });
});

describe("renderDocxPdf", () => {
  it("answers a single exportPdf with the printed bytes", async () => {
    plan([{ id: 1, kind: "print", w: 11906, h: 16838 }, { id: 2, kind: "done", ok: true }]);
    const out = await renderDocxPdf(docx, opts, concat);
    expect(Buffer.from(out.pdf).toString()).toBe(`%PDF-${11906 / 1440}x${16838 / 1440}`);
    expect(out.printCalls).toBe(1);
  });

  it("merges printPdfBuffer parts in the order saveMergedPdf names them", async () => {
    plan([
      { id: 1, kind: "part", w: 1440, h: 2880 },
      { id: 2, kind: "part", w: 2880, h: 1440 },
      { id: 3, kind: "merge", parts: ["ue-part:1", "ue-part:0"] },
      { id: 4, kind: "done", ok: true },
    ]);
    const out = await renderDocxPdf(docx, opts, concat);
    expect(Buffer.from(out.pdf).toString()).toBe("%PDF-2x1%PDF-1x2");
    expect(out.printCalls).toBe(2);
  });

  it("refuses a merge naming a part it never printed", async () => {
    plan([{ id: 1, kind: "merge", parts: ["ue-part:7"] }, { id: 2, kind: "done", ok: true }]);
    await expect(renderDocxPdf(docx, opts, concat)).rejects.toMatchObject({ reason: "renderer_printed_nothing" });
  });

  it("fails when the renderer reports a failed export", async () => {
    plan([{ id: 1, kind: "done", ok: false, error: "open failed" }]);
    await expect(renderDocxPdf(docx, opts, concat)).rejects.toMatchObject({
      code: "engine_result_invalid",
      reason: "renderer_export_failed:open failed",
    });
  });

  it("fails when a print call errors and nothing was printed", async () => {
    process.env.FAKE_MODE = "cdp_error";
    plan([{ id: 1, kind: "print", w: 1440, h: 1440 }, { id: 2, kind: "unknown" }, { id: 3, kind: "done", ok: true }]);
    await expect(renderDocxPdf(docx, opts, concat)).rejects.toMatchObject({ reason: "renderer_printed_nothing" });
  });

  it("names a browser that exits", async () => {
    process.env.FAKE_MODE = "exit";
    await expect(renderDocxPdf(docx, opts, concat)).rejects.toMatchObject({ code: "engine_crashed", reason: "chromium_exited" });
  });

  it("times out a renderer that never reports", async () => {
    process.env.FAKE_MODE = "hang";
    await expect(renderDocxPdf(docx, { ...opts, timeoutMs: 300 }, concat)).rejects.toMatchObject({ reason: "docs_pdf_timeout" });
  });

  it("is engine_incompatible without staged assets", async () => {
    await expect(renderDocxPdf(docx, { ...opts, chromiumPath: join(dir, "missing") }, concat)).rejects.toMatchObject({
      code: "engine_incompatible",
      reason: "docs_pdf_assets_missing",
    });
  });
});

describe("export:docx handler", () => {
  const run = async (payload: unknown, assets: string | undefined): Promise<RunMessage> => {
    await writeFile(join(dir, "input.docx"), docx);
    await writeFile(join(dir, "ops.json"), typeof payload === "string" ? payload : JSON.stringify(payload));
    return {
      type: "run",
      operation: "export",
      format: "docx",
      inputPath: join(dir, "input.docx"),
      outputPath: join(dir, "output.bin"),
      payloadPath: join(dir, "ops.json"),
      tempDir: dir,
      ...(assets ? { docsPdfAssetsDir: assets } : {}),
      sampleMs: 100,
      heapMb: 64,
      faults: false,
    };
  };
  const handler = findHandler("export", "docx")!;

  it("writes the rendered PDF and a result naming the renderer", async () => {
    plan([{ id: 1, kind: "print", w: 1440, h: 1440 }, { id: 2, kind: "done", ok: true }]);
    const outcome = await handler(await run({ target_format: "pdf", source_version_id: "V1" }, dir));
    expect(outcome).toMatchObject({ ok: true, result: { target_format: "pdf", source_version_id: "V1", print_calls: 1 } });
    expect((await readFile(join(dir, "output.bin"))).toString()).toBe("%PDF-1x1");
  });

  it("fails the job when the pdf lane refuses the merge", async () => {
    plan([{ id: 1, kind: "part", w: 1440, h: 1440 }, { id: 2, kind: "merge", parts: ["ue-part:0"] }, { id: 3, kind: "done", ok: true }]);
    // The fake part is not a real PDF: the pdf lane refuses the merge, the
    // page sees a failed save, and the job fails without an output.
    expect(await handler(await run({ target_format: "pdf" }, dir))).toEqual({
      ok: false,
      code: "engine_result_invalid",
      reason: "renderer_printed_nothing",
    });
  });

  it("refuses a target other than pdf, a bad payload and missing inputs", async () => {
    expect(await handler(await run({ target_format: "html" }, dir))).toEqual({ ok: false, code: "unsupported_operation", reason: "export_pair_not_bound" });
    expect(await handler(await run("{", dir))).toMatchObject({ ok: false, reason: "export_payload_invalid" });
    expect(await handler({ ...(await run({}, dir)), inputPath: null })).toMatchObject({ reason: "input_required" });
    expect(await handler({ ...(await run({}, dir)), payloadPath: null })).toMatchObject({ reason: "payload_required" });
  });

  it("is engine_incompatible when the renderer is not staged", async () => {
    expect(await handler(await run({ target_format: "pdf" }, undefined))).toEqual({
      ok: false,
      code: "engine_incompatible",
      reason: "docs_pdf_assets_missing",
    });
    expect(await handler(await run({ target_format: "pdf" }, join(dir, "nowhere")))).toMatchObject({ code: "engine_incompatible" });
  });
});

const realAssets = process.env.UNIWORK_DOCS_PDF_TEST_ASSETS;

describe.skipIf(!realAssets)("export:docx with the real renderer", () => {
  it("renders the kitchen-sink fixture to a PDF", { timeout: 120_000 }, async () => {
    const fixture = resolve(__dirname, "../../../../docs/office/g0/fixtures/files/docs/docx-kitchen-sink.docx");
    const out = await renderDocxPdf(
      new Uint8Array(await readFile(fixture)),
      { chromiumPath: join(realAssets!, "chromium"), bundleDir: join(realAssets!, "bundle"), profileDir: join(dir, "real"), timeoutMs: 100_000 },
      concat,
    );
    expect(Buffer.from(out.pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(out.printCalls).toBeGreaterThanOrEqual(1);
  });
});
