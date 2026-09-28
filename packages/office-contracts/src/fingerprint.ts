import { canonicalJson, sha256Hex } from "./canonical-json.ts";
import type { MeasuredInput, Sha256HexFn } from "./envelope.ts";

/**
 * Payload fingerprint: the identity of a job's RESULT-DECIDING inputs
 * (engine-contract.md §7.1), ported from payloadFingerprint. It omits
 * request_id and every presentation field, so a retry of the same work is
 * provably the same work while a changed payload is provably different.
 *
 * It hashes the INDEPENDENTLY MEASURED digest and length (passed in as
 * `inputs` after validateEnvelope decoded the actual bytes), never the
 * caller's declared values.
 *
 * deadline_ms is deliberately NOT part of the fingerprint. A deadline belongs
 * to grant/job TTL arithmetic, not to "is this the same work": an honest retry
 * that only moves the deadline is a replay, and because a replay returns the
 * ORIGINAL job, the accepted deadline is preserved and never extended.
 */
export async function payloadFingerprint(
  envelope: Record<string, unknown>,
  {
    inputs = null,
    hash = sha256Hex,
  }: { inputs?: MeasuredInput | null; hash?: Sha256HexFn } = {},
): Promise<string> {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const decisive = {
    contract_version: envelope.contract_version,
    protocol_version: envelope.protocol_version,
    operation: envelope.operation,
    format: envelope.format,
    input_checksum: inputs ? inputs.checksum : payload.input_checksum ?? null,
    input_length: inputs ? inputs.length : payload.input_length ?? null,
    base_revision: payload.base_revision ?? null,
    base_version_id: payload.base_version_id ?? null,
    document_model_ref: payload.document_model_ref ?? null,
    source_version_id: payload.source_version_id ?? null,
    engine_version: envelope.client_engine_version ?? null,
    target_format: payload.target_format ?? null,
    edits: payload.edits ?? null,
    export_options: payload.options ?? null,
  };
  const bytes = new TextEncoder().encode(canonicalJson(decisive));
  return hash(bytes);
}
