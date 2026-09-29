// @uniwork/office-engine/node — the Node-side transport and hashing. This
// entry may use node: builtins; nothing under src/browser/ or src/index.ts
// may reach it (enforced by lint and by scripts/office/check-boundaries.mjs).
//
// G2-02 owns the real engine service client. This entry provides the pieces
// that are already contract-bound: a synchronous SHA-256 for envelope
// measurement/fingerprinting, and an HTTP transport shaped by the contract's
// error semantics (engine_crashed on unreachable host, never silent success).

import { createHash } from "node:crypto";
import type { EngineOperation } from "@uniwork/office-contracts";
import { EngineBoundaryError, HostCapabilityRefusal } from "@uniwork/office-contracts";
import { createOfficeEngine, type OfficeEngine } from "../index";
import type { OfficeEngineTransport } from "../shared/types";

/** Synchronous SHA-256 for the facade's hash injection. */
export function nodeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface NodeTransportOptions {
  /** Engine service base URL, e.g. http://127.0.0.1:PORT/engine */
  baseUrl: string;
  /** Injected fetch for tests/hosts; defaults to the Node global. */
  fetchImpl?: typeof fetch;
  /** Operations actually bound on this service build. */
  boundOperations?: readonly EngineOperation[];
}

/**
 * POST the envelope to `${baseUrl}/submit`. An unreachable host maps to
 * engine_crashed (retryable) — the adapter-fault case
 * `adapter-unreachable-host-maps-to-engine-crashed` — never a silent success.
 */
export function createNodeEngineTransport(options: NodeTransportOptions): OfficeEngineTransport {
  const doFetch = options.fetchImpl ?? fetch;
  const bound = new Set<EngineOperation>(options.boundOperations ?? ["capability", "open", "edit", "serialize", "cancel"]);
  const base = options.baseUrl.replace(/\/+$/, "");
  return {
    supports: (operation) => bound.has(operation),
    async submit(envelope) {
      let res: Response;
      try {
        res = await doFetch(base + "/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(envelope),
        });
      } catch (error) {
        throw new EngineBoundaryError("engine_crashed", {
          reason: "unreachable_host",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null) {
        throw new EngineBoundaryError("engine_result_invalid", { reason: "non_json_result", status: res.status });
      }
      return body;
    },
    async cancel(jobId, reason) {
      let res: Response;
      try {
        res = await doFetch(base + "/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ job_id: jobId, reason }),
        });
      } catch (error) {
        throw new EngineBoundaryError("engine_crashed", {
          reason: "unreachable_host",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (body === null) {
        throw new EngineBoundaryError("engine_result_invalid", { reason: "non_json_result", status: res.status });
      }
      return body;
    },
  };
}

export function createNodeOfficeEngine(options: NodeTransportOptions): OfficeEngine {
  return createOfficeEngine({
    transport: createNodeEngineTransport(options),
    hash: nodeSha256Hex,
  });
}

export { HostCapabilityRefusal };
export type { OfficeEngine };
