// XLSX native-asset resolution (Node hosts only — never reachable from the
// browser entry). The service image stages the patched gateway bundle and the
// Rust sidecar under one directory; the deployer injects it via the job's
// RunMessage (config.UNIWORK_XLSX_ASSETS), and the bundled worker also checks
// ./xlsx-assets beside dist/, so a missing config still finds the files.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EngineBoundaryError } from "@uniwork/office-contracts";

const SIDECAR_NAME = process.platform === "win32" ? "xlsx-sidecar.exe" : "xlsx-sidecar";
const GATEWAY_NAME = "xlsx-gateway.mjs";

/** Candidate roots, first hit wins: caller-provided dir → dist sibling. */
function candidates(explicit?: string): string[] {
  return [
    explicit,
    // Bundled layout: this file compiles into dist/worker-run.mjs, so the
    // staged dir sits beside it. In a source checkout this candidate misses
    // (tests always pass an explicit dir), which is the point of the check.
    join(dirname(fileURLToPath(import.meta.url)), "xlsx-assets"),
  ].filter((d): d is string => typeof d === "string" && d.length > 0);
}

/** The gateway bundle — needed by open/serialize/edit. Resolution requires
    only the gateway file: a deployer may stage the browser-safe half alone,
    and recalc then fails-closed at sidecar resolution instead of blocking a
    probe. */
export function xlsxGatewayArtifactPath(assetsDir?: string): string {
  for (const dir of candidates(assetsDir)) {
    if (existsSync(join(dir, GATEWAY_NAME))) return join(dir, GATEWAY_NAME);
  }
  throw new EngineBoundaryError("engine_incompatible", {
    detail:
      "xlsx gateway artifact not staged — expected " +
      GATEWAY_NAME +
      " under the job's configured assets dir or beside the worker bundle",
  });
}

/** The Rust sidecar binary — needed only by the recalc-bearing edit path. */
export function xlsxSidecarPath(assetsDir?: string): string {
  for (const dir of candidates(assetsDir)) {
    if (existsSync(join(dir, SIDECAR_NAME))) return join(dir, SIDECAR_NAME);
  }
  throw new EngineBoundaryError("engine_incompatible", {
    detail:
      "xlsx sidecar binary not staged — expected " +
      SIDECAR_NAME +
      " under the job's configured assets dir or beside the worker bundle",
  });
}
