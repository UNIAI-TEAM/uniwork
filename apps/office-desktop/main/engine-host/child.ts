// Entry of the engine host utilityProcess (bundled to dist/main/engine-host.mjs).
// It owns the unbounded local engines (xlsx gateway, pdfium). Electron main
// forks it with `--max-old-space-size` sized from the machine, and survives its
// death: see supervisor.ts. argv[2] is the xlsx assets dir ("" = unset).
import { handleDesktopEngineCall, releaseRetainedPdfs, type DesktopEngineCall } from "@uniwork/office-engine/desktop";
import { serveEngineHost, type EngineHostPort } from "./serve";
import { createLocalXlsxEngine } from "../xlsx-engine";

const parentPort = (process as unknown as { parentPort?: EngineHostPort }).parentPort;
if (!parentPort) throw new Error("engine host must run as an Electron utilityProcess");
const assetsDir = process.argv[2] || undefined;
const xlsx = createLocalXlsxEngine(assetsDir === undefined ? {} : { assetsDir });

serveEngineHost(parentPort, {
  "xlsx-open": (payload) => xlsx.open((payload as { bytes: Uint8Array }).bytes),
  "xlsx-edit": (payload) => xlsx.edit((payload as { bytes: Uint8Array }).bytes, (payload as { edits: readonly unknown[] }).edits),
  "pdf-call": (payload) => handleDesktopEngineCall(payload as DesktopEngineCall),
  // The window's renderer reloaded, navigated, crashed or closed: free every
  // PDF it retained here (the handle store lives beside pdfium, in this child).
  "pdf-release": () => { releaseRetainedPdfs(); return Promise.resolve(null); },
});
