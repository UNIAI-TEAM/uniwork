// apps/web/platform/office — the web host's office engine boundary.
//
// This is the ONLY place the Next.js app wires the office engine: browser
// code goes through @uniwork/office-engine/browser over the host IPC port.
// Nothing here may reach Node, Electron or native facilities (enforced by
// scripts/office/check-boundaries.mjs and the package's lint rules).
//
// Host adapter implementations (the concrete IPC port that forwards to the
// engine webview/worker) land with the host-integration lane; this module is
// the boundary factory they plug into.

import { createBrowserOfficeEngine, type OfficeEngine } from "@uniwork/office-engine/browser";
import type { EngineOperation, HostIpcPort } from "@uniwork/office-contracts";

export interface WebOfficeBoundaryOptions {
  /** The host IPC port the webview adapter exposes. */
  ipc: HostIpcPort;
  /** Operations this host build has actually bound; anything else answers a
   * typed refusal instead of a 404-shaped silence. */
  boundOperations?: readonly EngineOperation[];
}

export function createWebOfficeEngine(options: WebOfficeBoundaryOptions): OfficeEngine {
  return createBrowserOfficeEngine(options);
}

export type { OfficeEngine, HostIpcPort };
export { createHttpPreviewAssetProxy, createOfficePreviewPort, type OfficePreviewPortOptions } from "./preview-port";
export {
  createXlsxFormatAdapter,
  createXlsxDocumentsTransport,
  createXlsxSaveTransport,
  type XlsxDocumentsTransport,
  type XlsxFormatAdapter,
  type XlsxFormatAdapterOptions,
  type XlsxRuntimeOpenResult,
  type XlsxRuntimeSerializedOutput,
  type XlsxSessionRuntime,
  type XlsxSaveTransportOptions,
} from "./xlsx-adapter";
export { XlsxOfficeEditorHost } from "./xlsx-office-host";
export { createWebXlsxSessionRuntime } from "./xlsx-runtime";
