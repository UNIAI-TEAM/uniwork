import type {
  EngineOperation,
  JobState,
  OfficeFormat,
} from "@uniwork/office-contracts";

// Shared transport surface the three runtime entries implement. A transport
// takes an already-validated envelope and returns the engine's raw result;
// the facade in ../index.ts owns validation, fingerprinting and public
// projection.

export interface OfficeEngineTransport {
  /** Submit an envelope. Returns the raw result object the engine answered -
   * either a per-operation result shape or a failed error envelope. */
  submit(envelope: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Cancel a job by id. Optional: transports without cancellation surface a
   * typed refusal at the facade instead. */
  cancel?(jobId: string, reason?: string): Promise<Record<string, unknown>>;
  /** Honest support probe. Returning false is legal; the facade reports the
   * operation unsupported rather than discovering it mid-flight. */
  supports?(operation: EngineOperation): boolean;
}

/** Envelope fields every caller must supply plus the contract constants the
 * facade fills. request_id/idempotency_key generation is the caller's - the
 * facade never invents identity. */
export interface SubmitInput {
  request_id: string;
  operation: EngineOperation;
  format: OfficeFormat;
  deadline_ms?: number;
  idempotency_key?: string;
  client_engine_version?: string;
  grant_id?: string;
  payload: Record<string, unknown>;
}

export interface PublicJobResult {
  job_id: string;
  state: JobState;
  operation: EngineOperation;
  [key: string]: unknown;
}
