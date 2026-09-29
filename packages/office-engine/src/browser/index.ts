// @uniwork/office-engine/browser — the browser-host transport. Pure web: no
// Node, Electron, native or canvas imports may appear in this subtree, even
// transitively (scripts/office/check-boundaries.mjs proves it on the tree).
//
// The engine runs in a webview/worker the host owns; this adapter routes
// contract envelopes through the host IPC port and validates results against
// the contract schemas. Paths and native handles never exist on this side.

import type {
  EngineOperation,
  HostIpcPort,
} from "@uniwork/office-contracts";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import { createOfficeEngine, type OfficeEngine } from "../index";
import type { OfficeEngineTransport } from "../shared/types";

/** The bridge channel the host IPC port carries engine envelopes on. Host
 * adapters implement it by forwarding to the engine surface they own (the
 * G0 lab calls the /engine/* routes; a production webview posts to its
 * worker). */
export const ENGINE_SUBMIT_CHANNEL = "engine:submit";
export const ENGINE_CANCEL_CHANNEL = "engine:cancel";

export interface BrowserTransportOptions {
  ipc: HostIpcPort;
  /** Operations this host has actually bound; anything else is a typed
   * refusal at the facade instead of a 404-shaped silence. */
  boundOperations?: readonly EngineOperation[];
}

export function createBrowserEngineTransport(options: BrowserTransportOptions): OfficeEngineTransport {
  const bound = new Set<EngineOperation>(options.boundOperations ?? ["capability", "open", "edit", "serialize", "cancel"]);
  return {
    supports: (operation) => bound.has(operation),
    async submit(envelope) {
      try {
        return await options.ipc.call(ENGINE_SUBMIT_CHANNEL as never, envelope as never);
      } catch (error) {
        if (error instanceof HostCapabilityRefusal) throw error;
        throw new HostCapabilityRefusal(
          ENGINE_SUBMIT_CHANNEL,
          "failed",
          "engine submit failed: " + (error instanceof Error ? error.message : String(error)),
        );
      }
    },
    async cancel(jobId, reason) {
      try {
        return await options.ipc.call(ENGINE_CANCEL_CHANNEL as never, { job_id: jobId, reason } as never);
      } catch (error) {
        if (error instanceof HostCapabilityRefusal) throw error;
        throw new HostCapabilityRefusal(
          ENGINE_CANCEL_CHANNEL,
          "failed",
          "engine cancel failed: " + (error instanceof Error ? error.message : String(error)),
        );
      }
    },
  };
}

/** Create the boundary client bound to a browser host IPC port. */
export function createBrowserOfficeEngine(options: BrowserTransportOptions): OfficeEngine {
  return createOfficeEngine({ transport: createBrowserEngineTransport(options) });
}

export type { OfficeEngine };
