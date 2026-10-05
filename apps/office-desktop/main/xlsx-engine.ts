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
import { createXlsxSidecar, xlsxGatewayArtifactPath, xlsxSidecarPath } from "@uniwork/office-engine/xlsx/native";

export interface LocalXlsxOpenResult {
  readonly snapshot: unknown;
  readonly renderModel: unknown;
}

export interface LocalXlsxEditResult {
  readonly bytes: Uint8Array;
  readonly checksum: string;
}

/** The main-owned local xlsx engine. Open and edit take the caller's bytes and
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
 *   2. the packaged resources/xlsx-assets dir, when it was staged.
 * A packaged build therefore finds the gateway WITHOUT an env var the user
 * must set (the R3-2 defect). Undefined falls through to the engine's own
 * sibling/typed-failure resolution, never a fake engine.
 */
export function resolveLocalXlsxAssetsDir({ resourcesPath, envAssetsDir }: { readonly resourcesPath?: string | undefined; readonly envAssetsDir?: string | undefined } = {}): string | undefined {
  if (envAssetsDir && envAssetsDir.trim().length > 0) return envAssetsDir;
  if (!resourcesPath) return undefined;
  const staged = join(resourcesPath, PACKAGED_XLSX_ASSETS_DIRECTORY);
  return existsSync(staged) ? staged : undefined;
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
      const opened = await openXlsxModel(await loadGateway(), bytes);
      return { snapshot: opened.snapshot, renderModel: opened.renderModel };
    },
    async edit(bytes, edits) {
      const gatewayFunctions = await loadGateway();
      const recalc = openRecalc();
      try {
        const output = await applyXlsxEditBytes(gatewayFunctions, recalc, bytes, [...edits]);
        return { bytes: output.bytes, checksum: `sha256:${sha256Hex(output.bytes)}` };
      } finally {
        // The adapter's release() already closes the port once a session
        // opened; an open that failed never got there. close() is
        // idempotent, so always reap the job's sidecar here.
        await recalc?.close().catch(() => {});
      }
    },
  };
}
