import { ENGINE_CONTRACT_VERSION, ENGINE_PROTOCOL_VERSION } from "./version.ts";
import { officeFormats, type OfficeFormat } from "./formats.ts";
import { engineOperations, type EngineOperation } from "./operations.ts";
import { ENGINE_LIMITS } from "./limits.ts";
import { EngineBoundaryError, EngineContractViolation } from "./errors.ts";

// Strict wire validation (engine-contract.md §5), ported from validateEnvelope
// in engine-contract.mjs. Under job transport framed/1 (SIZE-OPS1) the envelope carries
// only the input's declared tuple (input_checksum, input_length); the bytes
// follow it in the framed body, and the host measures them while it streams
// them (the engine refuses a digest or length that disagrees).
//
// Two failure classes are deliberate and both precede any job:
//   * EngineContractViolation - the request does not satisfy the schema
//     (unknown or caller-authority key - input_bytes included -, missing
//     field, wrong type, declared value not even a safe non-negative integer).
//   * EngineBoundaryError upload_bounds - a declared input_length over the
//     byte bound: the refusal is the 413 byte bound, not a schema slip.

export const TRUSTED_ENGINE_VERSIONS = ["genoffice@09485f88+uniwork-office.0"] as const;

/** Envelope-level fields. grant_id is accepted for wire compatibility but is
 * NOT authoritative: the grant itself is presented explicitly at run(). */
export const ENVELOPE_FIELDS = [
  "request_id",
  "contract_version",
  "protocol_version",
  "operation",
  "format",
  "deadline_ms",
  "idempotency_key",
  "client_engine_version",
  "grant_id",
  "payload",
  "declared_warnings",
] as const;

/** Fields a public caller may never supply, at envelope or payload level:
 * identity, destination and storage naming are engine-side authority. */
export const AUTHORITY_FIELDS = [
  "actor_id",
  "document_id",
  "organization_id",
  "workspace_id",
  "output_object_key",
  "output_key",
  "object_key",
  "storage_key",
  "bucket",
  "minio_key",
  "input_object_key",
  "source_object_key",
] as const;

/** Per-operation inbound payload allowlist. No operation inherits keys. */
export const PAYLOAD_FIELDS: Record<EngineOperation, readonly string[]> = {
  capability: ["max_input_bytes"],
  open: ["input_checksum", "input_length", "base_revision", "base_version_id", "edits", "locale", "document_model_ref"],
  edit: ["document_model_ref", "base_revision", "base_version_id", "edits", "input_checksum", "input_length", "locale"],
  serialize: ["document_model_ref", "base_revision", "base_version_id", "input_checksum", "input_length"],
  convert: [
    "source_version_id",
    "target_format",
    "overwrite_source",
    "options",
    "input_checksum",
    "input_length",
  ],
  // UNI-1013: export carries the bytes it renders like convert does - the
  // committed version, or the frame's unsaved edit of it - bound by the grant.
  // (Every input tuple names bytes that ride the framed body, never the JSON.)
  export: [
    "source_version_id",
    "target_format",
    "overwrite_source",
    "options",
    "input_checksum",
    "input_length",
  ],
  cancel: ["job_id", "reason"],
};

export const EDIT_FIELDS = ["op", "target", "text", "style", "range", "attributes"] as const;

const HEX64 = /^[0-9a-f]{64}$/;

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => v !== null && typeof v === "object" && !Array.isArray(v);

function violation(path: string, rule: string, detail?: string): never {
  throw new EngineContractViolation(path, rule, detail);
}

function requireKey(obj: unknown, key: string, fieldPath: string): unknown {
  if (!isDict(obj)) violation(fieldPath, "object_required", "expected an object");
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    violation(fieldPath + "." + key, "required", "missing");
  }
  return obj[key];
}

function requireString(
  value: unknown,
  fieldPath: string,
  { maxLength = ENGINE_LIMITS.max_identifier_length, minLength = 1 }: { maxLength?: number; minLength?: number } = {},
): string {
  if (typeof value !== "string") violation(fieldPath, "string_required", typeof value);
  if (value.length < minLength) violation(fieldPath, "too_short", "length " + value.length);
  if (value.length > maxLength) violation(fieldPath, "too_long", "length " + value.length);
  return value;
}

function requireSafeInt(
  value: unknown,
  fieldPath: string,
  { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {},
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    violation(fieldPath, "safe_integer_required", String(value));
  }
  if (value < min) violation(fieldPath, "below_min", value + " < " + min);
  if (value > max) violation(fieldPath, "above_max", value + " > " + max);
  return value;
}

function requireHex64(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || !HEX64.test(value)) {
    violation(fieldPath, "sha256_hex_required", "not 64 lowercase hex characters");
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], fieldPath: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    violation(fieldPath, "enum_required", "got " + JSON.stringify(value));
  }
  return value as T;
}

/** Reject any key that is not part of an object's per-operation schema. */
function requireOnlyKeys(obj: unknown, allowed: readonly string[], fieldPath: string): Dict {
  if (!isDict(obj)) violation(fieldPath, "object_required", "expected an object");
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      violation(fieldPath + "." + key, "unknown_field", "not part of the operation schema");
    }
  }
  return obj;
}

/** Reject caller-supplied authority and storage-destination fields outright.
 * This is the NARROW inbound rule, deliberately not scanForLeaks: the output
 * scanner exists to hide paths from a client, whereas here the problem is a
 * client asserting engine-side authority. */
function requireNoAuthority(obj: unknown, fieldPath: string): Dict {
  if (!isDict(obj)) return obj as Dict;
  for (const key of AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      violation(
        fieldPath + "." + key,
        "caller_authority_field",
        "the caller may not name identity, destination or another document",
      );
    }
  }
  return obj;
}

/** The input tuple a framed-transport envelope declares. The host measures the
 * framed bytes against it; the grant binds the same pair. */
export interface DeclaredInput {
  checksum: string;
  length: number;
}

function validateInputTuple(
  payload: Dict,
  fieldPath: string,
  { required = false, byteBound }: { required?: boolean; byteBound?: number } = {},
): DeclaredInput | null {
  const bound = byteBound ?? ENGINE_LIMITS.max_input_bytes;
  const hasChecksum = Object.prototype.hasOwnProperty.call(payload, "input_checksum");
  const hasLength = Object.prototype.hasOwnProperty.call(payload, "input_length");
  if (!hasChecksum && !hasLength) {
    if (required) {
      violation(fieldPath + ".input_checksum", "required", "this operation requires the caller to supply bytes");
    }
    return null;
  }
  if (!(hasChecksum && hasLength)) {
    violation(fieldPath, "checksum_tuple_incomplete", "input_checksum and input_length are validated together");
  }
  // A DECLARED length past the bound is the byte bound itself, not a schema
  // slip (size-cap:005): the typed 413. Non-integer, negative or unsafe
  // lengths stay contract violations.
  const length = requireSafeInt(payload.input_length, fieldPath + ".input_length", { min: 0 });
  if (length > bound) {
    throw new EngineBoundaryError("upload_bounds", { declared_length: length, max_input_bytes: bound });
  }
  const checksum = requireHex64(payload.input_checksum, fieldPath + ".input_checksum");
  return { checksum, length };
}

function validateEdits(edits: unknown): unknown[] {
  if (!Array.isArray(edits)) {
    violation("envelope.payload.edits", "array_required", typeof edits);
  }
  if (edits.length > ENGINE_LIMITS.max_edit_ops) {
    violation("envelope.payload.edits", "above_max", edits.length + " > " + ENGINE_LIMITS.max_edit_ops);
  }
  edits.forEach((e, i) => {
    requireOnlyKeys(e, EDIT_FIELDS, "envelope.payload.edits[" + i + "]");
    requireString(requireKey(e, "op", "envelope.payload.edits[" + i + "]"), "envelope.payload.edits[" + i + "].op");
  });
  return edits;
}

export interface ValidatedEnvelope {
  operation: EngineOperation;
  format: OfficeFormat;
  deadlineMs: number | null;
  inputs: DeclaredInput | null;
  editCount?: number;
  targetFormat?: OfficeFormat;
  /** convert and export: the source version the grant must name as its base. */
  sourceVersionId?: string;
}

/**
 * Validate an engine envelope BEFORE a grant or job is created. Returns the
 * borrowed values so a caller never re-derives them and never trusts its own
 * caller. The input tuple comes back as DECLARED: the host that receives the
 * framed bytes measures them against it before a job exists.
 *
 * `opts.inputByteBound` lets a host enforce a configured cap below the
 * contract ceiling (the engine's DOCUMENT_MAX_BYTES): a declared length over
 * it is refused before a byte of input is read. Callers that omit it keep the
 * contract ceiling.
 */
export async function validateEnvelope(
  envelope: unknown,
  opts: { trustedEngineVersions?: readonly string[]; inputByteBound?: number } = {},
): Promise<ValidatedEnvelope> {
  const trusted = opts.trustedEngineVersions ?? TRUSTED_ENGINE_VERSIONS;
  const inputByteBound = opts.inputByteBound ?? ENGINE_LIMITS.max_input_bytes;

  requireOnlyKeys(envelope, ENVELOPE_FIELDS, "envelope");
  requireNoAuthority(envelope, "envelope");
  requireString(requireKey(envelope, "request_id", "envelope"), "envelope.request_id");
  const env = envelope as Dict;

  const contractVersion = requireString(requireKey(env, "contract_version", "envelope"), "envelope.contract_version");
  if (contractVersion !== ENGINE_CONTRACT_VERSION) {
    violation("envelope.contract_version", "must_equal", contractVersion);
  }
  const protocolVersion = requireSafeInt(requireKey(env, "protocol_version", "envelope"), "envelope.protocol_version", { min: 0 });
  if (protocolVersion !== ENGINE_PROTOCOL_VERSION) {
    violation("envelope.protocol_version", "must_equal", String(protocolVersion));
  }
  const operation = requireEnum(requireKey(env, "operation", "envelope"), engineOperations, "envelope.operation");
  const format = requireEnum(requireKey(env, "format", "envelope"), officeFormats, "envelope.format");

  // Engine version negotiation is a typed boundary failure, not a schema slip:
  // checked AFTER operation/format and BEFORE deadline and payload allowlists.
  if (env.client_engine_version !== undefined) {
    requireString(env.client_engine_version, "envelope.client_engine_version");
    if (!trusted.includes(env.client_engine_version as string)) {
      throw new EngineBoundaryError("engine_incompatible", { want: trusted[0], got: env.client_engine_version });
    }
  }

  let deadlineMs: number | null = null;
  if (operation !== "cancel" && operation !== "capability") {
    deadlineMs = requireSafeInt(requireKey(env, "deadline_ms", "envelope"), "envelope.deadline_ms", {
      min: ENGINE_LIMITS.min_deadline_ms,
      max: ENGINE_LIMITS.max_deadline_ms,
    });
  }

  const payload = requireKey(env, "payload", "envelope");
  requireOnlyKeys(payload, PAYLOAD_FIELDS[operation], "envelope.payload");
  requireNoAuthority(payload, "envelope.payload");
  const p = payload as Dict;

  if (operation === "capability") {
    if (p.max_input_bytes !== undefined) {
      requireSafeInt(p.max_input_bytes, "envelope.payload.max_input_bytes", { min: 1, max: ENGINE_LIMITS.max_input_bytes });
    }
    return { operation, format, deadlineMs, inputs: null };
  }

  if (operation === "cancel") {
    if (p.reason !== undefined) requireString(p.reason, "envelope.payload.reason", { maxLength: 512 });
    requireString(requireKey(p, "job_id", "envelope.payload"), "envelope.payload.job_id");
    return { operation, format, deadlineMs, inputs: null };
  }

  if (operation === "open") {
    requireSafeInt(requireKey(p, "base_revision", "envelope.payload"), "envelope.payload.base_revision", { min: 0 });
    requireString(requireKey(p, "base_version_id", "envelope.payload"), "envelope.payload.base_version_id");
    const inputs = validateInputTuple(p, "envelope.payload", {
      required: true,
      byteBound: inputByteBound,
    });
    if (p.locale !== undefined) requireString(p.locale, "envelope.payload.locale", { maxLength: 35 });
    if (p.edits !== undefined) validateEdits(p.edits);
    if (p.document_model_ref !== undefined) {
      requireString(p.document_model_ref, "envelope.payload.document_model_ref");
    }
    return { operation, format, deadlineMs, inputs };
  }

  if (operation === "edit") {
    const edits = validateEdits(requireKey(p, "edits", "envelope.payload"));
    if (p.document_model_ref !== undefined) {
      requireString(p.document_model_ref, "envelope.payload.document_model_ref");
    }
    if (p.base_revision !== undefined) {
      requireSafeInt(p.base_revision, "envelope.payload.base_revision", { min: 0 });
    }
    if (p.base_version_id !== undefined) {
      requireString(p.base_version_id, "envelope.payload.base_version_id");
    }
    if (p.locale !== undefined) requireString(p.locale, "envelope.payload.locale", { maxLength: 35 });
    const inputs = validateInputTuple(p, "envelope.payload", {
      required: false,
      byteBound: inputByteBound,
    });
    return { operation, format, deadlineMs, inputs, editCount: edits.length };
  }

  if (operation === "convert") {
    // G2-07b binds the conversion source: like open/serialize, the source
    // version's bytes ride the frame under a declared checksum tuple (the grant
    // binds it), and target_format names the OOXML output. The source
    // version id is the grant's base: Go authorises converting exactly this
    // committed version.
    const sourceVersionId = requireString(
      requireKey(p, "source_version_id", "envelope.payload"),
      "envelope.payload.source_version_id",
    );
    const targetFormat = requireEnum(
      requireKey(p, "target_format", "envelope.payload"),
      officeFormats,
      "envelope.payload.target_format",
    );
    if (p.overwrite_source !== undefined && p.overwrite_source !== false) {
      violation("envelope.payload.overwrite_source", "must_be_false", "Q7-B forbids overwriting the committed source");
    }
    const inputs = validateInputTuple(p, "envelope.payload", {
      required: true,
      byteBound: inputByteBound,
    });
    return { operation, format, deadlineMs, targetFormat, sourceVersionId, inputs };
  }

  if (operation === "export") {
    // UNI-1013 binds export like convert: the rendered bytes ride the frame
    // under a declared tuple the grant binds, and the source version id is the
    // grant's base (the version the bytes were opened from).
    const sourceVersionId = requireString(
      requireKey(p, "source_version_id", "envelope.payload"),
      "envelope.payload.source_version_id",
    );
    const targetFormat = requireEnum(
      requireKey(p, "target_format", "envelope.payload"),
      officeFormats,
      "envelope.payload.target_format",
    );
    if (p.overwrite_source !== undefined && p.overwrite_source !== false) {
      violation("envelope.payload.overwrite_source", "must_be_false", "Q7-B forbids overwriting the committed source");
    }
    const inputs = validateInputTuple(p, "envelope.payload", {
      required: true,
      byteBound: inputByteBound,
    });
    return { operation, format, deadlineMs, targetFormat, sourceVersionId, inputs };
  }

  if (operation === "serialize") {
    requireString(requireKey(p, "document_model_ref", "envelope.payload"), "envelope.payload.document_model_ref");
    if (p.base_revision !== undefined) {
      requireSafeInt(p.base_revision, "envelope.payload.base_revision", { min: 0 });
    }
    if (p.base_version_id !== undefined) {
      requireString(p.base_version_id, "envelope.payload.base_version_id");
    }
    const inputs = validateInputTuple(p, "envelope.payload", {
      required: false,
      byteBound: inputByteBound,
    });
    return { operation, format, deadlineMs, inputs };
  }

  // Unreachable: requireEnum(engineOperations) already rejected anything else.
  throw new EngineContractViolation("envelope.operation", "unhandled", String(operation));
}
