import { createDesktopEngineTransport } from "@uniwork/office-engine/desktop";
import type { HostIpcPort } from "@uniwork/office-contracts";

/** Wiring seam for the shared engine. Credentials, local I/O and deep links
 * are intentionally absent; later G4 tasks attach their own host ports. */
export function createDesktopRuntimeAdapters(ipc: HostIpcPort) {
  return { transport: createDesktopEngineTransport({ ipc }) };
}
