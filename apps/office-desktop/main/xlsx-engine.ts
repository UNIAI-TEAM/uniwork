// Desktop LOCAL xlsx engine (C1b). This is the ONE place the Electron main
// process binds the bundled IronCalc sidecar + xlsx gateway for a local file:
// the renderer never imports this module (ADR 0021), and the local lane opens
// no network. It mirrors the engine service worker's one-shot path (open ->
// snapshot + render model; edit -> assembled bytes) so a local save is the
// same assemble+preserve+rebase the cloud/service path performs. The gateway
// artifact and sidecar binary are resolved from the packaged assets dir; a
// deployer that did not stage them gets a typed failure, never a fake result.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyXlsxEditBytes,
  bindXlsxGateway,
  openXlsxModel,
  type XlsxGatewayFunctions,
  type XlsxRecalcPort,
} from "@uniwork/office-engine/xlsx";
import { LOCAL_ENGINE_BOUNDS } from "../shared/local-engine-bounds";
import { createXlsxSidecar, xlsxGatewayArtifactPath, xlsxSidecarPath } from "@uniwork/office-engine/xlsx/native";

export interface LocalXlsxOpenResult {
  readonly snapshot: unknown;
  readonly renderModel: unknown;
}

export interface LocalXlsxEditResult {
  readonly bytes: Uint8Array;
  readonly checksum: string;
}

/** The local xlsx engine. It runs unbounded inside the engine host child
 *  (main/engine-host), never in the Electron main process, which holds the
 *  remote twin of this interface (engine-host/remote.ts). Open and edit take the caller's bytes and
 *  return only a bounded snapshot/byte answer; no path, handle or engine
 *  identity ever crosses back to the renderer. */
export interface LocalXlsxEngine {
  open(bytes: Uint8Array): Promise<LocalXlsxOpenResult>;
  edit(bytes: Uint8Array, edits: readonly unknown[]): Promise<LocalXlsxEditResult>;
}

export interface LocalXlsxEngineOptions {
  /** Dir holding the staged xlsx-gateway bundle + sidecar binary. In dev this
   *  is UNIWORK_XLSX_ASSETS; in a packaged build it is the staged
   *  resources/xlsx-assets dir (see resolveLocalXlsxAssetsDir). */
  readonly assetsDir?: string;
  /** Override for tests: bind a fake gateway instead of the artifact. */
  readonly engine?: XlsxGatewayFunctions;
  /** Override for tests: create one recalc port per edit job instead of
   *  spawning the staged sidecar. */
  readonly createRecalc?: () => XlsxRecalcPort;
}

/** The staged assets directory name inside an Electron package's resources. */
export const PACKAGED_XLSX_ASSETS_DIRECTORY = "xlsx-assets";

/**
 * Resolve the local xlsx assets dir. Precedence:
 *   1. an explicit dev dir (UNIWORK_XLSX_ASSETS), when set;
 *   2. the packaged resources/xlsx-assets dir, when it was staged;
 *   3. the dev bundle's dist/xlsx-assets dir, when scripts/build.mjs staged it
 *      (an unpackaged `electron <app>` run has no resources dir of its own).
 * A packaged build therefore finds the gateway WITHOUT an env var the user
 * must set (the R3-2 defect), and so does a dev build. Undefined falls through
 * to the engine's own sibling/typed-failure resolution, never a fake engine.
 */
export function resolveLocalXlsxAssetsDir({ resourcesPath, distDirectory, envAssetsDir }: { readonly resourcesPath?: string | undefined; readonly distDirectory?: string | undefined; readonly envAssetsDir?: string | undefined } = {}): string | undefined {
  if (envAssetsDir && envAssetsDir.trim().length > 0) return envAssetsDir;
  for (const root of [resourcesPath, distDirectory]) {
    if (!root) continue;
    const staged = join(root, PACKAGED_XLSX_ASSETS_DIRECTORY);
    if (existsSync(staged)) return staged;
  }
  return undefined;
}

/** The code main answers when a formula-bearing local save is refused because
 *  this build staged no recalc sidecar. It rides the error MESSAGE: Electron's
 *  invoke rejection keeps only the message, and the renderer re-types it so
 *  the save banner says why instead of office_unknown_error. */
export const LOCAL_XLSX_RECALC_UNAVAILABLE = "xlsx_recalc_unavailable";

function recalcUnavailable(): Error {
  return Object.assign(new Error(LOCAL_XLSX_RECALC_UNAVAILABLE), { name: "LocalXlsxEngineError", code: LOCAL_XLSX_RECALC_UNAVAILABLE });
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The engine build identity bound into each session, fixed at load time. */
export function createLocalXlsxEngine(options: LocalXlsxEngineOptions): LocalXlsxEngine {
  let gateway: Promise<XlsxGatewayFunctions> | null = null;
  const loadGateway = (): Promise<XlsxGatewayFunctions> => {
    if (options.engine) return Promise.resolve(options.engine);
    gateway ??= (async () => {
      const artifact = xlsxGatewayArtifactPath(options.assetsDir);
      return bindXlsxGateway((await import(pathToFileURL(artifact).href)) as never);
    })();
    return gateway;
  };
  // The recalc port is per-job: the adapter closes it terminally when the
  // job's last session ends, so a port cached across jobs failed every Save
  // after the first with engine_crashed (R4B-1). Each edit job spawns its own
  // sidecar, and a failure to create one is not remembered by the next job.
  const createRecalc = options.createRecalc ?? (() => createXlsxSidecar({ binaryPath: xlsxSidecarPath(options.assetsDir) }));
  const openRecalc = (): XlsxRecalcPort | undefined => {
    try {
      return createRecalc();
    } catch {
      // A missing sidecar only refuses formula-bearing saves (the adapter
      // fails closed); a formula-free edit still completes.
      return undefined;
    }
  };
  return {
    async open(bytes) {
      const opened = await openXlsxModel(await loadGateway(), bytes, { bounds: LOCAL_ENGINE_BOUNDS });
      return { snapshot: opened.snapshot, renderModel: opened.renderModel };
    },
    async edit(bytes, edits) {
      const gatewayFunctions = await loadGateway();
      const recalc = openRecalc();
      try {
        const output = await applyXlsxEditBytes(gatewayFunctions, recalc, bytes, [...edits], undefined, LOCAL_ENGINE_BOUNDS);
        return { bytes: output.bytes, checksum: `sha256:${sha256Hex(output.bytes)}` };
      } catch (error) {
        // Without a port the adapter refuses a formula-bearing serialize with
        // unsupported_operation (never stale <v>s); name the missing sidecar.
        if (!recalc && (error as { code?: unknown } | null)?.code === "unsupported_operation") throw recalcUnavailable();
        throw error;
      } finally {
        // The adapter's release() already closes the port once a session
        // opened; an open that failed never got there. close() is
        // idempotent, so always reap the job's sidecar here. A close that
        // throws, even synchronously, must not mask the job's real outcome.
        try {
          await recalc?.close();
        } catch {
          // ignore: the job already succeeded or failed on its own
        }
      }
    },
  };
}
