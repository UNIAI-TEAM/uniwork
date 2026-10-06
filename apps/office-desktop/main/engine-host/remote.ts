import { totalmem } from "node:os";
import type { DesktopEngineCall, DesktopEngineCallResult } from "@uniwork/office-engine/desktop";
import type { LocalXlsxEngine, LocalXlsxEditResult, LocalXlsxOpenResult } from "../xlsx-engine";
import type { EngineHostChild } from "./protocol";
import { createEngineHostClient, type EngineHostClient } from "./supervisor";

/** The local xlsx engine as seen from main: every job runs in the child. */
export function createRemoteXlsxEngine(client: EngineHostClient): LocalXlsxEngine {
  return {
    open: async (bytes) => await client.call("xlsx-open", { bytes }) as LocalXlsxOpenResult,
    edit: async (bytes, edits) => await client.call("xlsx-edit", { bytes, edits }) as LocalXlsxEditResult,
  };
}

/** The pdf engine call as seen from main (`desktop:engine-call`). */
export function createRemotePdfCall(client: EngineHostClient): (call: DesktopEngineCall) => Promise<DesktopEngineCallResult> {
  return async (call) => await client.call("pdf-call", call) as DesktopEngineCallResult;
}

/** Old-space ceiling for the child: "unbounded" means bounded by the machine,
 *  so give it most of the physical memory (never below V8's small default). */
export function engineHostHeapMegabytes(totalBytes: number = totalmem()): number {
  return Math.max(2048, Math.floor((totalBytes * 0.75) / (1024 * 1024)));
}

/** Bind the engine host: `fork` is Electron's utilityProcess.fork. Nothing is
 *  spawned until the first request. */
export function createLocalEngineHost(options: { readonly fork: (script: string, args: string[], options: { serviceName: string; execArgv: string[] }) => EngineHostChild; readonly script: string; readonly assetsDir: string | undefined }): { readonly xlsx: LocalXlsxEngine; readonly pdfCall: ReturnType<typeof createRemotePdfCall>; dispose(): void } {
  const client = createEngineHostClient(() => options.fork(options.script, [options.assetsDir ?? ""], { serviceName: "uniwork-engine-host", execArgv: [`--max-old-space-size=${engineHostHeapMegabytes()}`] }));
  return { xlsx: createRemoteXlsxEngine(client), pdfCall: createRemotePdfCall(client), dispose: () => client.dispose() };
}
