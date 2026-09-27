// apps/office-engine — the UniWork Office engine service host scaffold.
//
// G2-02 owns the actual service (HTTP binding, grant issuing, job ledger).
// This scaffold binds the contract-shaped Node transport behind an injected
// endpoint so later work lands inside the boundary instead of around it: the
// service talks to the engine through @uniwork/office-engine/node, enforces
// the contract envelope, and refuses to start unconfigured rather than
// pretending a default engine exists.

import { createNodeOfficeEngine, nodeSha256Hex, type OfficeEngine } from "@uniwork/office-engine/node";
import { ENGINE_VERSION_TRUSTED, HostCapabilityRefusal } from "@uniwork/office-contracts";

export interface EngineServiceConfig {
  /** Engine service base URL, e.g. http://127.0.0.1:PORT/engine */
  engineBaseUrl?: string;
  /** Engine build the host trusts; defaults to the G0 pinned build. */
  clientEngineVersion?: string;
}

export interface EngineServiceHost {
  engine: OfficeEngine;
  /** Contract identity the service negotiates for. */
  clientEngineVersion: string;
  sha256(bytes: Uint8Array): string;
}

/**
 * Bind the engine transport. No endpoint => a typed refusal: a service host
 * without an engine surface is a deployment error, not a silent passthrough.
 */
export function createEngineServiceHost(config: EngineServiceConfig = {}): EngineServiceHost {
  if (!config.engineBaseUrl) {
    throw new HostCapabilityRefusal(
      "service:engine-transport",
      "unbound",
      "engineBaseUrl is required - the engine service cannot guess its engine",
    );
  }
  return {
    engine: createNodeOfficeEngine({
      baseUrl: config.engineBaseUrl,
      boundOperations: ["capability", "open", "edit", "serialize", "cancel"],
    }),
    clientEngineVersion: config.clientEngineVersion ?? ENGINE_VERSION_TRUSTED,
    sha256: nodeSha256Hex,
  };
}
