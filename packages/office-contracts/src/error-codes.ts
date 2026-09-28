import { z } from "zod";

// Engine-boundary error table, ported verbatim from ERROR_CODES in
// scripts/office-g0/engine-contract.mjs (engine-contract.md §4.7). A boundary
// result is switchable on `code`; error_class exists so one client path serves
// every conflict instead of inferring behaviour from a status number or
// message text. `status` is the HTTP status Go is expected to answer with
// eventually.
export type EngineErrorClass =
  | "grant"
  | "conflict"
  | "permission"
  | "incompatible"
  | "engine"
  | "quota"
  | "storage"
  | "missing";

export interface EngineErrorSpec {
  status: number;
  error_class: EngineErrorClass;
  kind: string;
  retryable: boolean;
}

export const ENGINE_ERROR_CODES = {
  grant_expired: { status: 401, error_class: "grant", kind: "grant_ttl", retryable: false },
  grant_consumed: { status: 409, error_class: "conflict", kind: "grant_single_use", retryable: false },
  grant_scope: { status: 403, error_class: "permission", kind: "grant_scope", retryable: false },
  grant_actor_mismatch: { status: 403, error_class: "permission", kind: "grant_actor", retryable: false },
  job_conflict: { status: 409, error_class: "conflict", kind: "idempotency_actor", retryable: false },
  payload_fingerprint_mismatch: { status: 409, error_class: "conflict", kind: "idempotency_payload", retryable: false },
  in_flight: { status: 409, error_class: "conflict", kind: "idempotency_in_flight", retryable: true },
  invalid_transition: { status: 409, error_class: "conflict", kind: "state_transition", retryable: false },
  engine_incompatible: { status: 409, error_class: "incompatible", kind: "engine_version", retryable: false },
  protocol_mismatch: { status: 409, error_class: "incompatible", kind: "protocol_version", retryable: false },
  contract_mismatch: { status: 409, error_class: "incompatible", kind: "contract_version", retryable: false },
  engine_timeout: { status: 504, error_class: "engine", kind: "deadline_exceeded", retryable: true },
  engine_cancelled: { status: 499, error_class: "engine", kind: "cancelled", retryable: false },
  engine_crashed: { status: 502, error_class: "engine", kind: "engine_unavailable", retryable: true },
  engine_overloaded: { status: 503, error_class: "engine", kind: "backpressure", retryable: true },
  engine_result_invalid: { status: 502, error_class: "engine", kind: "malformed_result", retryable: true },
  engine_checksum_mismatch: { status: 502, error_class: "engine", kind: "output_checksum", retryable: true },
  upload_missing: { status: 409, error_class: "conflict", kind: "upload_unknown", retryable: false },
  upload_checksum_mismatch: { status: 409, error_class: "conflict", kind: "upload_checksum", retryable: false },
  upload_bounds: { status: 413, error_class: "quota", kind: "byte_bound", retryable: false },
  upload_already_consumed: { status: 409, error_class: "conflict", kind: "upload_consumed", retryable: false },
  commit_failed: { status: 409, error_class: "conflict", kind: "commit_rollback", retryable: true },
  base_version_mismatch: { status: 409, error_class: "conflict", kind: "base_version", retryable: false },
  object_missing: { status: 500, error_class: "storage", kind: "orphan_ledger", retryable: true },
  not_found: { status: 404, error_class: "missing", kind: "unknown_resource", retryable: false },
  // An operation this boundary does not implement. Named so a caller can
  // branch on the code instead of the boundary silently routing every
  // operation through the serialize commit path.
  unsupported_operation: { status: 501, error_class: "incompatible", kind: "unsupported_operation", retryable: false },
} as const satisfies Record<string, EngineErrorSpec>;

export type EngineErrorCode = keyof typeof ENGINE_ERROR_CODES;
export const engineErrorCodeSchema = z.enum(
  Object.keys(ENGINE_ERROR_CODES) as [EngineErrorCode, ...EngineErrorCode[]],
);

export function engineErrorSpec(code: EngineErrorCode): EngineErrorSpec {
  return ENGINE_ERROR_CODES[code];
}
export function isRetryableEngineError(code: EngineErrorCode): boolean {
  return ENGINE_ERROR_CODES[code].retryable;
}
