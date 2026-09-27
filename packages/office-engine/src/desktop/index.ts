// @uniwork/office-engine/desktop — the desktop-host transport. The desktop
// host owns paths and file handles; they stay on the host side of the IPC
// port and never reach a browser-facing result (ADR 0021 identity rules,
// engine-contract.md SS10.2). Electron imports would live in the host app,
// not in this package — the transport below is framework-free by contract.

import type { EngineOperation, HostIpcPort } from "@uniwork/office-contracts";
import { HostCapabilityRefusal } from "@uniwork/office-contracts";
import { createOfficeEngine, type OfficeEngine } from "../index";
import type { OfficeEngineTransport } from "../shared/types";

/** Native facilities only a desktop host can provide. A host without them
 * answers the typed refusal; the contract never fakes them. */
export interface DesktopNativeBridge {
  /** Open a host file the user picked; returns bytes + a host-side handle
   * identifier the engine may reference (never a browser-visible path). */
  openNativeFile?(handleId: string): Promise<Uint8Array>;
  /** Persist bytes to a host path the user chose. */
  writeNativeFile?(handleId: string, bytes: Uint8Array): Promise<void>;
}

export interface DesktopTransportOptions {
  ipc: HostIpcPort;
  native?: DesktopNativeBridge;
  boundOperations?: readonly EngineOperation[];
}

export function createDesktopEngineTransport(options: DesktopTransportOptions): OfficeEngineTransport {
  const bound = new Set<EngineOperation>(options.boundOperations ?? ["capability", "open", "edit", "serialize", "cancel"]);
  return {
    supports: (operation) => bound.has(operation),
    async submit(envelope) {
      try {
        return await options.ipc.call("engine:submit" as never, envelope as never);
      } catch (error) {
        if (error instanceof HostCapabilityRefusal) throw error;
        throw new HostCapabilityRefusal(
          "engine:submit",
          "failed",
          "engine submit failed: " + (error instanceof Error ? error.message : String(error)),
        );
      }
    },
    async cancel(jobId, reason) {
      try {
        return await options.ipc.call("engine:cancel" as never, { job_id: jobId, reason } as never);
      } catch (error) {
        if (error instanceof HostCapabilityRefusal) throw error;
        throw new HostCapabilityRefusal(
          "engine:cancel",
          "failed",
          "engine cancel failed: " + (error instanceof Error ? error.message : String(error)),
        );
      }
    },
  };
}

/** Read through the native bridge; an unbound bridge is a typed refusal. */
export async function desktopOpenNativeFile(
  native: DesktopNativeBridge | undefined,
  handleId: string,
): Promise<Uint8Array> {
  if (!native?.openNativeFile) {
    throw new HostCapabilityRefusal(
      "desktop:open-native-file",
      "unbound",
      "this desktop host did not bind a native file bridge",
    );
  }
  return native.openNativeFile(handleId);
}

export function createDesktopOfficeEngine(options: DesktopTransportOptions): OfficeEngine {
  return createOfficeEngine({ transport: createDesktopEngineTransport(options) });
}

export type { OfficeEngine };
