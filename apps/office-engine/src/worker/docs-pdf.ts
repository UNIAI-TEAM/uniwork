// export:docx -> pdf (UNI-1013). The PDF comes from the same renderer the
// desktop app prints with: the pinned genoffice Docs web bundle runs in a
// headless Chromium, the renderer paginates the document itself, and its own
// headless-export path calls exportPdf / printPdfBuffer / saveMergedPdf. A
// page shim answers those calls with Page.printToPDF using exactly the options
// desktop main passes to webContents.printToPDF (custom page size in inches,
// zero margins, printBackground, the renderer's scale). Measured against the
// desktop export in docs/office/pdf-export-decision.md.
//
// Chromium is driven over --remote-debugging-pipe (fd 3/4, NUL-framed JSON),
// so the engine takes no browser-automation dependency. The bundle and the
// document are served from a loopback server that lives only for this job,
// and every other host resolves to nothing: the renderer cannot reach the
// network. Three layers hold the renderer to that server: the host resolver
// maps every other name to nothing, a CDP Fetch interceptor fails every request
// whose origin is not this job's own loopback port (127.0.0.1 also hosts the
// engine's own listener and whatever else the container runs), and the server
// sends the bundle's pinned Content-Security-Policy. Chromium's own sandbox is
// off (--no-sandbox) only when the job runs under its per-slot uid
// (sandbox.ts; the handler refuses the job otherwise), because a uid-dropped
// process in a container cannot create the user namespaces Chromium's sandbox
// needs; the supervisor owns and kills the whole process tree, Chromium included.

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import type { Readable, Writable } from "node:stream";

const TWIPS_PER_INCH = 1440;

/** Window size desktop's hidden export window uses (docs-main exportDocsHeadless). */
const VIEWPORT = { width: 1360, height: 900 };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const INPUT_PATH = "/__input.docx";

export class DocsPdfError extends Error {
  constructor(
    readonly code: "engine_incompatible" | "engine_crashed" | "engine_result_invalid",
    readonly reason: string,
  ) {
    super(reason);
    this.name = "DocsPdfError";
  }
}

export interface DocsPdfOptions {
  /** Chromium (or chrome-headless-shell) executable. */
  chromiumPath: string;
  /** Directory holding the built Docs web bundle (index.html at its root). */
  bundleDir: string;
  /** Job-private directory Chromium may use as its profile. */
  profileDir: string;
  timeoutMs: number;
  /**
   * Pass --no-sandbox. Only for a job already confined by the engine's per-slot
   * uid sandbox; without it Chromium keeps (and, in a container, fails closed
   * on) its own sandbox.
   */
  noSandbox: boolean;
}

/** printToPDF parameters for one print call, as desktop main builds them. */
export function printParams(pageWidthTwips: number, pageHeightTwips: number, scale?: number): Record<string, unknown> {
  if (!(pageWidthTwips > 0) || !(pageHeightTwips > 0)) {
    throw new DocsPdfError("engine_result_invalid", "page_size_invalid");
  }
  return {
    paperWidth: pageWidthTwips / TWIPS_PER_INCH,
    paperHeight: pageHeightTwips / TWIPS_PER_INCH,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    printBackground: true,
    preferCSSPageSize: false,
    ...(scale && scale > 0 && scale !== 1 ? { scale } : {}),
  };
}

/** Resolve a request path inside root, or null for anything that escapes it. */
export function resolveBundlePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const target = resolve(base, "." + (decoded === "/" ? "/index.html" : decoded));
  return target === base || target.startsWith(base + sep) ? target : null;
}

/** Used when the bundle ships no readable csp.json: the frame's own policy, minus the framing it never needs here. */
export const FALLBACK_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";

/** The Content-Security-Policy the bundle was built to be served with (its csp.json `value`), else the fallback. */
export async function bundleCsp(bundleDir: string): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(join(bundleDir, "csp.json"), "utf8")) as { header?: unknown; value?: unknown };
    if (typeof raw.value === "string" && raw.value.trim() !== "" && (raw.header === undefined || raw.header === "Content-Security-Policy")) return raw.value;
  } catch {
    // No readable policy file: the fallback below is just as strict.
  }
  return FALLBACK_CSP;
}

/**
 * Whether the renderer may load `url`: this job's own loopback origin, plus the
 * schemes that never leave the page. Everything else (another loopback port,
 * another host, a file: URL) is failed before it is sent.
 */
export function isAllowedRequest(url: string, port: number): boolean {
  if (/^(data|blob|about):/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" && parsed.port === String(port);
  } catch {
    return false;
  }
}

/** Serve the bundle and the one input document on 127.0.0.1 for this job. */
export async function serveBundle(bundleDir: string, docx: Uint8Array): Promise<Server> {
  const csp = await bundleCsp(bundleDir);
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const reply = (status: number, body: Uint8Array | string, type = "text/plain") => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(body);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return reply(405, "");
    if (path === INPUT_PATH) return reply(200, docx, DOCX_MIME);
    const file = resolveBundlePath(bundleDir, path);
    if (!file) return reply(404, "");
    readFile(file).then(
      (bytes) => reply(200, bytes, MIME[extname(file).toLowerCase()] ?? "application/octet-stream"),
      () => reply(404, ""),
    );
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok());
  });
  return server;
}

/**
 * Runs in the page before the bundle: wraps the bridge object the bundle
 * installs as window.desktop so the renderer's headless-export path prints
 * through the engine. Calls go out through the __uePdf binding as JSON and
 * come back through window.__ueReply. printPdfBuffer parts stay in the engine;
 * the page only sees an opaque marker per part.
 */
export const PAGE_SHIM = `(() => {
  let real;
  let consumed = false;
  let next = 0;
  const pending = new Map();
  const call = (msg) => new Promise((ok) => {
    const id = ++next;
    pending.set(id, ok);
    window.__uePdf(JSON.stringify({ id, ...msg }));
  });
  window.__ueReply = (id, value) => {
    const ok = pending.get(id);
    pending.delete(id);
    if (ok) ok(value);
  };
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    get: () => real,
    set(v) {
      real = v;
      v.consumeHeadlessExport = async () => {
        if (consumed) return null;
        consumed = true;
        return { outPath: 'engine:output.pdf', format: 'pdf' };
      };
      v.headlessExportDone = (report) => { void call({ kind: 'done', ok: report && report.ok === true, error: report && report.error }); };
      v.exportPdf = (_name, w, h, _out, scale) => call({ kind: 'print', w, h, scale });
      v.printPdfBuffer = (w, h, scale) => call({ kind: 'part', w, h, scale });
      v.saveMergedPdf = (_name, parts) => call({ kind: 'merge', parts });
    },
  });
})();`;

/** Minimal CDP client over --remote-debugging-pipe. */
class CdpPipe {
  private seq = 0;
  private buffer = "";
  private readonly waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  private readonly listeners: ((method: string, params: Record<string, unknown>, sessionId?: string) => void)[] = [];

  constructor(
    private readonly out: Writable,
    input: Readable,
  ) {
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => this.read(chunk));
  }

  onEvent(fn: (method: string, params: Record<string, unknown>, sessionId?: string) => void): void {
    this.listeners.push(fn);
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((ok, fail) => {
      this.waiting.set(id, { ok: ok as (v: unknown) => void, fail });
      this.out.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }

  failAll(error: Error): void {
    for (const w of this.waiting.values()) w.fail(error);
    this.waiting.clear();
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\0")) >= 0) {
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let msg: { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(raw) as typeof msg;
      } catch {
        continue;
      }
      if (typeof msg.id === "number") {
        const w = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (!w) continue;
        if (msg.error) w.fail(new Error(msg.error.message ?? "cdp_error"));
        else w.ok(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg.method, msg.params ?? {}, msg.sessionId);
      }
    }
  }
}

/** Chromium's command line for one job. */
export function launchArgs(opts: Pick<DocsPdfOptions, "profileDir" | "noSandbox">): string[] {
  return [
    "--headless",
    "--remote-debugging-pipe",
    ...(opts.noSandbox ? ["--no-sandbox"] : []),
    // A container's /dev/shm is 64 MiB by default; a large document crashes the renderer without this.
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--mute-audio",
    "--font-render-hinting=none",
    // Only the job's loopback server resolves; everything else fails fast.
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    `--user-data-dir=${opts.profileDir}`,
    "about:blank",
  ];
}

function launch(opts: DocsPdfOptions): ChildProcess {
  return spawn(opts.chromiumPath, launchArgs(opts), { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
}

interface PrintCall {
  id: number;
  kind: "print" | "part" | "merge" | "done";
  w?: number;
  h?: number;
  scale?: number;
  parts?: string[];
  ok?: boolean;
  error?: string;
}

/**
 * Render one DOCX to PDF bytes. `merge` joins printPdfBuffer parts in page
 * order (the renderer chunks long or mixed-paper documents, as on desktop).
 */
export async function renderDocxPdf(
  docx: Uint8Array,
  opts: DocsPdfOptions,
  merge: (parts: Uint8Array[]) => Promise<Uint8Array>,
): Promise<{ pdf: Uint8Array; printCalls: number }> {
  try {
    await stat(join(opts.bundleDir, "index.html"));
    await stat(opts.chromiumPath);
  } catch {
    throw new DocsPdfError("engine_incompatible", "docs_pdf_assets_missing");
  }
  const server = await serveBundle(opts.bundleDir, docx);
  const chrome = launch(opts);
  const cdp = new CdpPipe(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable);
  let timer: NodeJS.Timeout | undefined;
  try {
    const exited = new Promise<never>((_, fail) => {
      chrome.once("error", () => fail(new DocsPdfError("engine_incompatible", "chromium_spawn_failed")));
      chrome.once("exit", () => fail(new DocsPdfError("engine_crashed", "chromium_exited")));
    });
    const timedOut = new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new DocsPdfError("engine_crashed", "docs_pdf_timeout")), opts.timeoutMs);
    });
    // The losers of the race reject later (the kill below fires "exit"); they
    // are settled here so they never surface as unhandled rejections.
    exited.catch(() => {});
    timedOut.catch(() => {});
    const work = drive(cdp, (server.address() as AddressInfo).port, merge);
    work.catch(() => {});
    return await Promise.race([work, exited, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
    cdp.failAll(new Error("closed"));
    chrome.kill("SIGKILL");
    server.close();
  }
}

async function drive(
  cdp: CdpPipe,
  port: number,
  merge: (parts: Uint8Array[]) => Promise<Uint8Array>,
): Promise<{ pdf: Uint8Array; printCalls: number }> {
  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const parts: Uint8Array[] = [];
  let result: Uint8Array | null = null;
  let printCalls = 0;
  const finished = new Promise<{ ok: boolean; error?: string }>((settle) => {
    cdp.onEvent((method, params, sid) => {
      if (sid !== sessionId || method !== "Runtime.bindingCalled" || params.name !== "__uePdf") return;
      let msg: PrintCall;
      try {
        msg = JSON.parse(String(params.payload)) as PrintCall;
      } catch {
        return;
      }
      if (msg.kind === "done") {
        settle({ ok: msg.ok === true, error: msg.error });
        return;
      }
      void answer(msg)
        .then(
          (value) => reply(msg.id, value),
          (error: unknown) => reply(msg.id, { ok: false, error: String(error) }),
        )
        // A reply racing the teardown has no page left to reach.
        .catch(() => {});
    });
  });
  const reply = (id: number, value: unknown) =>
    cdp.send("Runtime.evaluate", { expression: `window.__ueReply(${id}, ${JSON.stringify(value)})` }, sessionId);
  const print = async (msg: PrintCall): Promise<Uint8Array> => {
    printCalls++;
    const { data } = await cdp.send<{ data: string }>("Page.printToPDF", printParams(msg.w ?? 0, msg.h ?? 0, msg.scale), sessionId);
    return Buffer.from(data, "base64");
  };
  const answer = async (msg: PrintCall): Promise<unknown> => {
    switch (msg.kind) {
      case "print":
        result = await print(msg);
        return { ok: true, path: "engine:output.pdf" };
      case "part":
        parts.push(await print(msg));
        return { ok: true, base64: `ue-part:${parts.length - 1}` };
      case "merge": {
        const picked = (msg.parts ?? []).map((marker) => {
          const index = /^ue-part:(\d+)$/.exec(marker)?.[1];
          const part = index === undefined ? undefined : parts[Number(index)];
          if (!part) throw new DocsPdfError("engine_result_invalid", "merge_part_unknown");
          return part;
        });
        result = await merge(picked);
        return { ok: true, path: "engine:output.pdf" };
      }
      default:
        return { ok: false, error: "unknown_call" };
    }
  };
  // Fail every request that is not for this job's own origin (see isAllowedRequest).
  cdp.onEvent((method, params, sid) => {
    if (sid !== sessionId || method !== "Fetch.requestPaused") return;
    const requestId = String(params.requestId);
    const url = String((params.request as { url?: unknown } | undefined)?.url ?? "");
    const verdict = isAllowedRequest(url, port)
      ? cdp.send("Fetch.continueRequest", { requestId }, sessionId)
      : cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId);
    // A verdict racing the teardown has no page left to reach.
    verdict.catch(() => {});
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Runtime.addBinding", { name: "__uePdf" }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_SHIM }, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html?headless=1&open=${INPUT_PATH}` }, sessionId);
  const report = await finished;
  if (!report.ok) throw new DocsPdfError("engine_result_invalid", `renderer_export_failed:${report.error ?? "unknown"}`.slice(0, 200));
  if (!result) throw new DocsPdfError("engine_result_invalid", "renderer_printed_nothing");
  return { pdf: result, printCalls };
}
