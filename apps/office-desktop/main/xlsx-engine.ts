// Desktop LOCAL xlsx engine (C1b). This is the ONE place the Electron main
// process binds the bundled IronCalc sidecar + xlsx gateway for a local file:
// the renderer never imports this module (ADR 0021), and the local lane opens
// no network. It mirrors the engine service worker's one-shot path (open ->
// snapshot + render model; edit -> assembled bytes) so a local save is the
// same assemble+preserve+rebase the cloud/service path performs. The gateway
// artifact and sidecar binary are resolved from the packaged assets dir; a
// deployer that did not stage them gets a typed failure, never a fake result.
import { createHash } from "node:crypto";
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
  /** Dir holding the staged xlsx-gateway bundle + sidecar binary
   *  (UNIWORK_XLSX_ASSETS in dev; the packaged assets dir in production). */
  readonly assetsDir?: string;
  /** Override for tests: bind a fake gateway/recalc instead of the artifacts. */
  readonly engine?: XlsxGatewayFunctions;
  readonly recalc?: XlsxRecalcPort;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The engine build identity bound into each session, fixed at load time. */
export function createLocalXlsxEngine(options: LocalXlsxEngineOptions): LocalXlsxEngine {
  let gateway: Promise<XlsxGatewayFunctions> | null = null;
  let sidecar: XlsxRecalcPort | null | undefined;
  const loadGateway = (): Promise<XlsxGatewayFunctions> => {
    if (options.engine) return Promise.resolve(options.engine);
    gateway ??= (async () => {
      const artifact = xlsxGatewayArtifactPath(options.assetsDir);
      return bindXlsxGateway((await import(pathToFileURL(artifact).href)) as never);
    })();
    return gateway;
  };
  const loadRecalc = (): XlsxRecalcPort | undefined => {
    if (options.recalc !== undefined) return options.recalc;
    if (sidecar === null) return undefined;
    try {
      sidecar ??= createXlsxSidecar({ binaryPath: xlsxSidecarPath(options.assetsDir) });
      return sidecar;
    } catch {
      // A missing sidecar only refuses formula-bearing saves (the adapter
      // fails closed); a formula-free edit still completes.
      sidecar = null;
      return undefined;
    }
  };
  return {
    async open(bytes) {
      const opened = await openXlsxModel(await loadGateway(), bytes);
      return { snapshot: opened.snapshot, renderModel: opened.renderModel };
    },
    async edit(bytes, edits) {
      const output = await applyXlsxEditBytes(await loadGateway(), loadRecalc(), bytes, [...edits]);
      return { bytes: output.bytes, checksum: `sha256:${sha256Hex(output.bytes)}` };
    },
  };
}
