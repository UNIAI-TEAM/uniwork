// DOC-003 lab engine host: the "Office Engine Service" role of INT-01.
//
// The GenOffice engines are modules inside the prepared source tree. This host
// loads them from there by absolute path; the source tree stays a READ-ONLY
// module/code root and is never a document root. Document bytes move only
// through the lab tree (--lab): reads are contained and reparse-checked, the
// input is snapshotted before an edit, and every write is a staged atomic
// replace. No route silently succeeds, and no route writes to the source tree.
//
// Run through the prepared source''s tsx:
//   <source>/node_modules/.bin/tsx e2e/office-g0/engine-host.mts \
//     --source <dir> --lab <dir> [--port 5391] [--prebundle <file>]
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDir, sha256, snapshotCopy, statFile } from "./engine-paths.mts";
import { PdfEngineError, createPdfEngine, type PdfEngine } from "./engine-pdf.mts";
import { PptxEngineError, type PptxEngine, type PptxRunTxn } from "./engine-pptx-types.mts";
import { createPptxEngine, loadPptxEngineFromSource } from "./engine-pptx.mts";
import { XlsxEngineError, createXlsxEngine, loadXlsxDeps, type XlsxEngine } from "./engine-xlsx.mts";
import { DocxEngineError, createDocxEngine, loadDocxDeps, type DocxEngine } from "./engine-docx.mts";
import { createDocxRoutes } from "./engine-docx-routes.mts";
import { createPdfRoutes } from "./engine-pdf-routes.mts";
import { createPptxRoutes } from "./engine-pptx-routes.mts";
import { createXlsxRoutes } from "./engine-xlsx-routes.mts";
import {
  EnginePathError,
  EngineRequestError,
  createPaths,
  requireString,
  type EngineName,
  type HostContext,
  type RouteMap,
  type SessionRoutes,
  type StartedEngine,
} from "./engine-host-context.mts";

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string): string => {
  const index = args.indexOf("--" + name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

const PORT = Number(argOf("port", "5391"));
const SOURCE = resolve(argOf("source", "."));
const LAB = resolve(argOf("lab", "lab"));
const PREBUNDLE = resolve(argOf("prebundle", join(LAB, "engine", "pptx-ops.mjs")));
const OUT_DIR = join(LAB, "out");
const TMP_DIR = join(LAB, "tmp");


/** Engines created once per process; each module loads on its first access. */
export interface Engines {
  readonly pdf: Promise<PdfEngine>;
  readonly pptx: Promise<PptxEngine>;
  readonly xlsx: Promise<XlsxEngine>;
  readonly docx: Promise<DocxEngine>;
  /** Only the engines a request has already started; never starts one. */
  started(): StartedEngine[];
}

export function createEngines(root: string, prebundle: string): Engines {
  const started: StartedEngine[] = [];
  const cache = new Map<EngineName, Promise<unknown>>();

  /** Memoize a lazy load: the first access starts it, later accesses reuse it. */
  const once = <T,>(name: EngineName, load: () => Promise<T>): Promise<T> => {
    const cached = cache.get(name) as Promise<T> | undefined;
    if (cached) return cached;
    const promise = load();
    // A route that never awaits a failed load must not become an unhandled
    // rejection; a caller that does await it still sees the failure.
    promise.catch(() => undefined);
    cache.set(name, promise);
    started.push({ name, promise });
    return promise;
  };

  return {
    get pdf() {
      return once("pdf", () => createPdfEngine(root));
    },

    get pptx() {
      return once("pptx", async () => {
        // The engine pair and the op prebundle load together on the first PPTX route.
        const enginePair = await loadPptxEngineFromSource(root);
        const mod = (await import(pathToFileURL(prebundle).href)) as { runTxn?: PptxRunTxn };
        const runTxn = mod.runTxn;
        if (typeof runTxn !== "function") {
          throw new EngineRequestError("prebundle_invalid", "prebundle has no runTxn export: " + prebundle);
        }
        return createPptxEngine({ loadTxn: () => runTxn, ...enginePair });
      });
    },

    get xlsx() {
      return once("xlsx", async () => {
        const deps = await loadXlsxDeps(root);
        return createXlsxEngine({ ...deps, sha256, snapshot: snapshotCopy });
      });
    },

    get docx() {
      return once("docx", async () => createDocxEngine(await loadDocxDeps(root)));
    },

    started: () => [...started],
  };
}

export interface EngineHost {
  handle(route: string, input: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Compose the host from the per-format route families. Creation reads no file and
 * boots no engine: `ping`, `read-file`, host creation and a close with no sessions
 * stay off the native sidecar entirely.
 */
export function createHost(root: string, lab: string, prebundle: string): EngineHost {
  const paths = createPaths(lab);
  const engines = createEngines(root, prebundle);
  const ctx: HostContext = { ...paths, source: root, prebundle, engines };

  const docx = createDocxRoutes(ctx);
  const pptx = createPptxRoutes(ctx);
  const xlsx = createXlsxRoutes(ctx);
  const pdf = createPdfRoutes(ctx);

  /** Route families that own per-view session state released on shutdown. */
  const sessionOwners: SessionRoutes[] = [pptx, xlsx];

  let closing: Promise<void> | null = null;
  let closed = false;
  /** Admitted handlers, so shutdown drains them before releasing their resources. */
  const inFlight = new Set<Promise<unknown>>();

  const routes: RouteMap = {
    "/engine/ping": async () => ({
      ok: true,
      source: root,
      lab,
      prebundle,
      routes: Object.keys(routes).sort(),
    }),

    "/engine/read-file": async (input) => {
      const target = paths.labFile(input.path);
      const bytes = await paths.read(target);
      return { path: target, size: bytes.length, hash: paths.sha256(bytes), base64: bytes.toString("base64") };
    },

    ...docx.routes,
    ...pptx.routes,
    ...xlsx.routes,
    ...pdf.routes,

    "/engine/session-close": async (input) => {
      const viewId = requireString(input.viewId, "viewId");
      const closed = await Promise.all([pptx.closeSession(viewId), xlsx.closeSession(viewId)]);
      // The sidecar session is an initialized resource: release it only because a
      // workbook session existed, never as a reason to boot the engine here.
      if (engines.started().some((entry) => entry.name === "xlsx")) {
        await (await engines.xlsx).close(viewId);
      }
      return { closed: closed.some(Boolean) };
    },
  };

  return {
    handle: async (route, input) => {
      // A closed host refuses new work before any route or engine is reached.
      if (closed) throw new EngineRequestError("host_closed", "engine host is closed");
      const handler = routes[route];
      if (!handler) throw new EngineRequestError("no_route", "no engine handler for " + route);
      const pending = handler(input);
      inFlight.add(pending);
      try {
        return await pending;
      } finally {
        inFlight.delete(pending);
      }
    },
    // Idempotent: the first call shuts down, later calls await the same result.
    // New work is refused at once; admitted work drains first, so every session
    // it created still exists when the maps are cleared.
    close: async () => {
      if (closing) return closing;
      closing = (async () => {
        closed = true;
        await Promise.all(
          [...inFlight].map((pending) => pending.then(() => undefined, () => undefined)),
        );
        // Route-owned session maps are local state; clearing them cannot fail.
        for (const owner of sessionOwners) await owner.closeAll();
        // Await only engines a request actually started. A rejected load is a
        // failed load with nothing left to release, not a cleanup failure; a
        // rejected close on a loaded engine is a cleanup failure and must show.
        const failures: unknown[] = [];
        for (const { name, promise } of engines.started()) {
          const engine = await promise.catch(() => undefined);
          if (engine === undefined || name !== "xlsx") continue;
          try {
            await (engine as XlsxEngine).closeAll();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length > 0) throw failures[0];
      })();
      return closing;
    },
  };
}

export function startServer(host: EngineHost, port: number): { close: () => Promise<void> } {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const respond = (status: number, payload: unknown): void => {
      const body = Buffer.from(JSON.stringify(payload));
      res.writeHead(status, { "content-type": "application/json", "content-length": body.length });
      res.end(body);
    };
    if (req.method !== "POST") {
      respond(405, { ok: false, code: "method_not_allowed", error: "engine host accepts POST only" });
      return;
    }
    let input: Record<string, unknown> = {};
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      input = raw.length === 0 ? {} : (JSON.parse(raw) as Record<string, unknown>);
    } catch {
      respond(400, { ok: false, code: "bad_json", error: "request body is not JSON" });
      return;
    }
    try {
      respond(200, { ok: true, result: await host.handle(url.pathname, input) });
    } catch (error) {
      const code =
        error instanceof EngineRequestError ||
        error instanceof EnginePathError ||
        error instanceof PdfEngineError ||
        error instanceof PptxEngineError ||
        error instanceof XlsxEngineError ||
        error instanceof DocxEngineError
          ? error.code
          : "engine_error";
      const message = error instanceof Error ? error.message : String(error);
      respond(200, { ok: false, code, error: message });
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log("engine host on http://127.0.0.1:" + port + " source=" + SOURCE + " lab=" + LAB);
  });
  let closing: Promise<void> | null = null;
  return {
    // Repeated close awaits the same shutdown instead of re-closing the server.
    close: async () => {
      if (closing) return closing;
      closing = (async () => {
        // HTTP teardown and host cleanup run together and both must settle: an
        // HTTP-only settle is not resource release, and neither failure may mask
        // the other.
        const settle = (work: Promise<unknown>): Promise<unknown> =>
          work.then(() => null, (error: unknown) => error);
        const httpClose = new Promise<void>((done, fail) => {
          server.close((error) => (error ? fail(error) : done()));
        });
        const [httpError, hostError] = await Promise.all([settle(httpClose), settle(host.close())]);
        if (httpError !== null) throw httpError;
        if (hostError !== null) throw hostError;
      })();
      return closing;
    },
  };
}

const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("engine-host.mts") || process.argv[1].endsWith("engine-host.mjs"));

if (isMain) {
  await ensureDir(OUT_DIR);
  await ensureDir(TMP_DIR);
  startServer(createHost(SOURCE, LAB, PREBUNDLE), PORT);
}

export { EngineRequestError, statFile };
