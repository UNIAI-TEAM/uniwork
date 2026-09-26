#!/usr/bin/env node
// DOC-004 (UNI-668) - Office Engine boundary contract: typed wire model + harness.
//
// This file is the runnable half of docs/office/g0/engine-contract.md. It models
// the boundary between UniWork Go (auth/ACL/quota/version/audit/outbox) and the
// private internal Office Engine Service (parse/serialize/render/convert), then
// drives that model through the fault cases the G0 plan requires for task 4.4.
//
// What this file IS. A reference model of the engine boundary: a strict wire
// validator, an explicit cancellation/complete linearization, a job ledger that
// persists an output object before Go commits a reference to it, and fault cases
// whose expected values are written literally so a model that drifts from the
// contract fails instead of redefining success.
//
// What this file is NOT, and must never be quoted as. There is no HTTP server,
// no Go service, no product auth/ACL/tenant isolation, no real engine, no object
// store, no browser and no Electron here. Authorization, storage and engine
// execution are injected fakes declared in EVIDENCE_REGISTRY. Nothing here
// substitutes for the task-4.4 run against the real DOC-003 adapter, for the
// DOC-003 six-browser flows (still pending, owned by UNI-667), or for G1/G2
// service tests. createBoundary accepts an injected engine so main can wire the
// real engines later; that wiring is not done here and these model tests do not
// fulfil the task-4.4 acceptance.
//
// Node 22 built-ins only. No product imports, no third-party dependency.
//
//   node scripts/office-g0/engine-contract.mjs
//   node scripts/office-g0/engine-contract.mjs --print --out <path>
//   node --test scripts/office-g0/engine-contract.test.mjs
//
// Exit code 0 only when every case matches its oracle.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Model revision of this reference contract. Bumped whenever the wire changes. */
export const CONTRACT_VERSION = "uniwork-office-engine-contract/1";
/** Engine wire protocol version the boundary negotiates against. */
export const PROTOCOL_VERSION = 1;
/** Every wire field and enum value is snake_case; asserted, not assumed. */
export const WIRE_FORMAT = "snake_case";

export const CONTRACT_DOC = "docs/office/g0/engine-contract.md";
export const RUNTIME_MAP_DOC = "docs/office/g0/module-runtime-map.json";

/** Formats the boundary may be asked about. An unknown format is not_found. */
export const FORMATS = ["docx", "xlsx", "pptx", "pdf", "md", "html"];

/** Operations the boundary exposes. Task 4.2 names each of them. */
export const OPERATIONS = ["capability", "open", "edit", "serialize", "convert", "export", "cancel"];

/**
 * Finite, safe bounds. Written as integers a hostile caller cannot exceed, so the
 * boundary rejects an absurd size or deadline before a job exists. The test suite
 * asserts they are finite safe integers instead of trusting this comment, and
 * validateEnvelope rejects any request outside them.
 */
export const LIMITS = Object.freeze({
  max_input_bytes: 64 * 1024 * 1024,
  max_output_bytes: 128 * 1024 * 1024,
  max_edit_ops: 20000,
  max_deadline_ms: 600000,
  min_deadline_ms: 1,
  max_warnings: 512,
  max_identifier_length: 128,
});

/** Job states. The last five are terminal. */
export const JOB_STATES = ["accepted", "running", "completed", "failed", "timed_out", "cancelled", "crashed"];
export const TERMINAL_STATES = ["completed", "failed", "timed_out", "cancelled", "crashed"];

/** Fidelity warnings the engine may raise. A warning never blocks a commit. */
export const FIDELITY_WARNING_CODES = [
  "fonts_substituted",
  "unsupported_construct_preserved",
  "layout_approximate",
  "formula_not_recalculated",
  "external_reference_dropped",
  "macro_preserved_not_executed",
  "signature_invalidated",
  "ocr_not_applied",
];

/**
 * Engine-boundary error table. Deliberately separate from DOC-005's session and
 * sync table in login-sync-contract.md: that one owns token, revision, draft and
 * feed errors; this one owns job, engine, grant and object errors. A boundary
 * result is switchable on code; error_class exists so one client path serves every
 * conflict instead of the client inferring behaviour from a status number or from
 * message text.
 *
 * status is the HTTP status Go is expected to answer with eventually. It is
 * recorded because this contract is what G1/G2 implement, not because this file
 * serves HTTP.
 */
export const ERROR_CODES = {
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
  // An operation this reference model does not implement. It is named so a caller
  // can branch on the code, instead of the boundary silently routing every
  // operation through the serialize commit path.
  unsupported_operation: { status: 501, error_class: "incompatible", kind: "unsupported_operation", retryable: false },
};

const RETRYABLE = new Set(Object.keys(ERROR_CODES).filter((k) => ERROR_CODES[k].retryable));

/** Boundary failure. Every failure this model raises is a code in ERROR_CODES, so a
 * test asserts on a code, never on a stack trace or on message text. */
export class BoundaryError extends Error {
  constructor(code, fields = {}) {
    super(code);
    const spec = ERROR_CODES[code];
    if (!spec) throw new Error("unknown boundary error code: " + code);
    this.name = "BoundaryError";
    this.code = code;
    this.status = spec.status;
    this.error_class = spec.error_class;
    this.kind = spec.kind;
    this.retryable = spec.retryable;
    this.fields = fields;
  }
  toJSON() {
    return {
      code: this.code,
      status: this.status,
      error_class: this.error_class,
      kind: this.kind,
      retryable: this.retryable,
      fidelity_preserved: true,
      ...this.fields,
    };
  }
}

/** Wire validation failure. Distinct from BoundaryError: this means the CALLER
 * handed the boundary a request or result that does not satisfy the schema, which
 * is a contract bug, not an engine outcome. It is never retryable. */
export class ContractViolation extends Error {
  constructor(field_path, rule, detail) {
    super("wire violation at " + field_path + ": " + rule + (detail === undefined ? "" : " (" + detail + ")"));
    this.name = "ContractViolation";
    this.field_path = field_path;
    this.rule = rule;
    this.detail = detail === undefined ? null : detail;
  }
  toJSON() { return { kind: "contract_violation", field_path: this.field_path, rule: this.rule, detail: this.detail }; }
}

// ---------------------------------------------------------------------------
// Canonical JSON, checksums and fingerprints
// ---------------------------------------------------------------------------

/** SHA-256 over BYTES, never over a description of bytes. */
export function sha256Bytes(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Stable JSON: object keys sorted recursively, so two spellings of the same
 * payload produce one fingerprint. Arrays keep their order (edit order matters). */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

/**
 * Payload fingerprint: the identity of a job's RESULT-DECIDING inputs. It omits
 * request_id (different on every attempt) and every presentation field, so a
 * retry of the same work is provably the same work while a changed payload is
 * provably different.
 *
 * It hashes the INDEPENDENTLY MEASURED digest and length (passed in as `inputs`
 * after validateEnvelope decoded the actual bytes), never the caller's declared
 * values. document_model_ref and source_version_id are decisive and are included:
 * the copied candidate omitted them, so a retry that swapped the model reference
 * was accepted as a replay of the original work.
 *
 * deadline_ms is deliberately NOT part of the fingerprint. A deadline belongs to
 * grant/job TTL arithmetic, not to "is this the same work". An honest retry that
 * only moves the deadline is therefore a replay, and because a replay returns the
 * ORIGINAL job, the accepted deadline is preserved and never extended. Omitting it
 * is a contract decision, not a default: §7.1/§7.3 state the same rule.
 */
export function payloadFingerprint(envelope, { inputs = null } = {}) {
  const payload = envelope.payload ?? {};
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
  return sha256Bytes(Buffer.from(canonicalJson(decisive), "utf8"));
}

// ---------------------------------------------------------------------------
// Strict wire validation
// ---------------------------------------------------------------------------

/** Engine builds this boundary trusts. Anything else is engine_incompatible
 * BEFORE a job exists; the caller cannot pick its own build. */
export const TRUSTED_ENGINE_VERSIONS = ["genoffice@09485f88+uniwork-office.0"];

/** Envelope-level fields. grant_id is accepted for wire compatibility but is NOT
 * authoritative: run() takes the grant explicitly and reads the registry. */
const ENVELOPE_FIELDS = [
  "request_id", "contract_version", "protocol_version", "operation", "format",
  "deadline_ms", "idempotency_key", "client_engine_version", "grant_id", "payload",
  "declared_warnings",
];

/** Fields a public caller may never supply, at envelope or payload level. */
const AUTHORITY_FIELDS = [
  "actor_id", "document_id", "organization_id", "workspace_id", "output_object_key",
  "output_key", "object_key", "storage_key", "bucket", "minio_key", "input_object_key",
  "source_object_key",
];

/** Per-operation inbound payload allowlist. No operation inherits another's keys. */
const PAYLOAD_FIELDS = {
  capability: ["max_input_bytes"],
  open: ["input_bytes", "input_checksum", "input_length", "base_revision", "base_version_id", "edits", "locale", "document_model_ref"],
  edit: ["document_model_ref", "base_revision", "base_version_id", "edits", "input_bytes", "input_checksum", "input_length", "locale"],
  serialize: ["document_model_ref", "base_revision", "base_version_id", "input_bytes", "input_checksum", "input_length"],
  convert: ["source_version_id", "target_format", "overwrite_source", "options"],
  export: ["source_version_id", "target_format", "overwrite_source", "options"],
  cancel: ["job_id", "reason"],
};

const EDIT_FIELDS = ["op", "target", "text", "style", "range", "attributes"];

const HEX64 = /^[0-9a-f]{64}$/;
const ULID_LIKE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function requireKey(obj, key, fieldPath) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new ContractViolation(fieldPath, "object_required", "expected an object");
  }
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    throw new ContractViolation(fieldPath + "." + key, "required", "missing");
  }
  return obj[key];
}

function requireString(value, fieldPath, { maxLength = LIMITS.max_identifier_length, minLength = 1 } = {}) {
  if (typeof value !== "string") throw new ContractViolation(fieldPath, "string_required", typeof value);
  if (value.length < minLength) throw new ContractViolation(fieldPath, "too_short", "length " + value.length);
  if (value.length > maxLength) throw new ContractViolation(fieldPath, "too_long", "length " + value.length);
  return value;
}

function requireSafeInt(value, fieldPath, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ContractViolation(fieldPath, "safe_integer_required", String(value));
  }
  if (value < min) throw new ContractViolation(fieldPath, "below_min", value + " < " + min);
  if (value > max) throw new ContractViolation(fieldPath, "above_max", value + " > " + max);
  return value;
}

function requireHex64(value, fieldPath) {
  if (typeof value !== "string" || !HEX64.test(value)) {
    throw new ContractViolation(fieldPath, "sha256_hex_required", "not 64 lowercase hex characters");
  }
  return value;
}

function requireEnum(value, allowed, fieldPath) {
  if (!allowed.includes(value)) {
    throw new ContractViolation(fieldPath, "enum_required", "got " + JSON.stringify(value));
  }
  return value;
}

function requireBool(value, fieldPath) {
  if (typeof value !== "boolean") throw new ContractViolation(fieldPath, "boolean_required", typeof value);
  return value;
}

/** Reject any key that is not part of an object's per-operation schema. */
function requireOnlyKeys(obj, allowed, fieldPath) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new ContractViolation(fieldPath, "object_required", "expected an object");
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new ContractViolation(fieldPath + "." + key, "unknown_field", "not part of the operation schema");
    }
  }
  return obj;
}

/**
 * Reject caller-supplied authority and storage-destination fields outright. A
 * public caller may not name its own identity, another document, or where bytes
 * are written. This is a NARROW inbound rule, deliberately not scanForLeaks: the
 * browser-output scanner exists to hide paths from a client, whereas here the
 * problem is a client asserting engine-side authority.
 */
function requireNoAuthority(obj, fieldPath) {
  if (obj === null || typeof obj !== "object") return obj;
  for (const key of AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      throw new ContractViolation(fieldPath + "." + key, "caller_authority_field", "the caller may not name identity, destination or another document");
    }
  }
  return obj;
}

/**
 * Strict base64 decoder. Node's Buffer.from(text, "base64") SILENTLY DROPS
 * characters outside the alphabet - the same permissiveness the DOC-005 store
 * review flagged - so a caller could smuggle bytes past a declared length while
 * the declared digest still matched the truncated buffer. This rejects any
 * character outside [A-Za-z0-9+/=], malformed padding, an impossible length, and
 * non-canonical encodings (unused bits set).
 */
export function decodeStrictBase64(text, fieldPath) {
  if (typeof text !== "string") throw new ContractViolation(fieldPath, "string_required", typeof text);
  if (text.length === 0) return Buffer.alloc(0);
  if (/[^A-Za-z0-9+/=]/.test(text)) {
    throw new ContractViolation(fieldPath, "base64_alphabet", "character outside the base64 alphabet");
  }
  const pad = text.indexOf("=");
  if (pad !== -1) {
    if (pad < text.length - 2 || !/^={1,2}$/.test(text.slice(pad))) {
      throw new ContractViolation(fieldPath, "base64_padding", "padding must be terminal and one or two characters");
    }
    if (text.length % 4 !== 0) {
      throw new ContractViolation(fieldPath, "base64_padding", "padded base64 length must be a multiple of 4");
    }
  } else if (text.length % 4 === 1) {
    throw new ContractViolation(fieldPath, "base64_length", "unpadded base64 length cannot be 1 mod 4");
  }
  const bytes = Buffer.from(text, "base64");
  const stripPad = (s) => s.replace(/=+$/, "");
  if (stripPad(bytes.toString("base64")) !== stripPad(text)) {
    throw new ContractViolation(fieldPath, "base64_canonical", "non-canonical base64 (unused bits or padding set)");
  }
  return bytes;
}

/**
 * Validate input bytes at the boundary, before any job or grant exists. When the
 * caller supplies bytes it must supply the whole tuple - input_bytes,
 * input_checksum and input_length - and the bytes are DECODED and measured, never
 * trusted. Order matches doc §5: schema, then actual byte bound, then declared vs
 * measured length, then declared vs measured digest.
 */
function validateInputBytes(payload, fieldPath, { required = false, byteBound } = {}) {
  const bound = byteBound ?? LIMITS.max_input_bytes;
  const hasBytes = Object.prototype.hasOwnProperty.call(payload, "input_bytes");
  const hasChecksum = Object.prototype.hasOwnProperty.call(payload, "input_checksum");
  const hasLength = Object.prototype.hasOwnProperty.call(payload, "input_length");
  if (!hasBytes && !hasChecksum && !hasLength) {
    if (required) {
      throw new ContractViolation(fieldPath + ".input_bytes", "required", "this operation requires the caller to supply bytes");
    }
    return null;
  }
  if (!(hasBytes && hasChecksum && hasLength)) {
    throw new ContractViolation(fieldPath, "checksum_tuple_incomplete", "input_bytes, input_checksum and input_length are validated together");
  }
  const declaredLength = requireSafeInt(payload.input_length, fieldPath + ".input_length", { min: 0, max: LIMITS.max_input_bytes });
  const declaredChecksum = requireHex64(payload.input_checksum, fieldPath + ".input_checksum");
  const text = requireString(payload.input_bytes, fieldPath + ".input_bytes", { minLength: 0, maxLength: LIMITS.max_output_bytes * 2 });
  const bytes = decodeStrictBase64(text, fieldPath + ".input_bytes");
  if (bytes.length > bound) {
    throw new BoundaryError("upload_bounds", { measured_length: bytes.length, max_input_bytes: bound });
  }
  if (declaredLength !== bytes.length) {
    throw new BoundaryError("upload_checksum_mismatch", { declared_length: declaredLength, measured_length: bytes.length });
  }
  const measured = sha256Bytes(bytes);
  if (declaredChecksum !== measured) {
    throw new BoundaryError("upload_checksum_mismatch", { declared_checksum: declaredChecksum, measured });
  }
  return { bytes, checksum: measured, length: bytes.length };
}

function validateEdits(edits) {
  if (!Array.isArray(edits)) throw new ContractViolation("envelope.payload.edits", "array_required", typeof edits);
  if (edits.length > LIMITS.max_edit_ops) throw new ContractViolation("envelope.payload.edits", "above_max", edits.length + " > " +
  LIMITS.max_edit_ops);
  edits.forEach((e, i) => {
    requireOnlyKeys(e, EDIT_FIELDS, "envelope.payload.edits[" + i + "]");
    requireString(requireKey(e, "op", "envelope.payload.edits[" + i + "]"), "envelope.payload.edits[" + i + "].op");
  });
  return edits;
}

/**
 * Validate an engine envelope BEFORE a grant or job is created. This is the
 * function the malformed-* cases call: every rejection happens with the current
 * revision untouched and the input bytes unread. It returns the borrowed values
 * so a caller never has to re-derive them and never has to trust its own caller.
 *
 * Two failure classes are deliberate and both precede any job:
 *   * ContractViolation - the request does not satisfy the schema (unknown or
 *     caller-authority key, missing field, wrong type, declared value outside its
 *     own bound).
 *   * BoundaryError upload_* - the request is schema-valid but the ACTUAL bytes
 *     disagree with what was declared: decoded length over the byte bound
 *     (upload_bounds), decoded length != declared length, or measured SHA-256 !=
 *     declared checksum (upload_checksum_mismatch).
 * A model-reference-only serialize/edit is legitimate WITHOUT bytes: bytes are
 * validated WHEN PRESENT, and run() then requires the reference to resolve to
 * trusted scoped state instead of inventing a byte-upload requirement.
 */
export function validateEnvelope(envelope) {
  requireOnlyKeys(envelope, ENVELOPE_FIELDS, "envelope");
  requireNoAuthority(envelope, "envelope");
  requireKey(envelope, "request_id", "envelope");
  requireString(envelope.request_id, "envelope.request_id");
  const contractVersion = requireString(requireKey(envelope, "contract_version", "envelope"), "envelope.contract_version");
  if (contractVersion !== CONTRACT_VERSION) {
    throw new ContractViolation("envelope.contract_version", "must_equal", contractVersion);
  }
  const protocolVersion = requireSafeInt(requireKey(envelope, "protocol_version", "envelope"), "envelope.protocol_version", { min: 0 });
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new ContractViolation("envelope.protocol_version", "must_equal", String(protocolVersion));
  }
  const operation = requireEnum(requireKey(envelope, "operation", "envelope"), OPERATIONS, "envelope.operation");
  const format = requireEnum(requireKey(envelope, "format", "envelope"), FORMATS, "envelope.format");

  // Engine version negotiation is a typed boundary failure, not a schema slip: a
  // caller cannot present a build this boundary does not trust.
  if (envelope.client_engine_version !== undefined) {
    requireString(envelope.client_engine_version, "envelope.client_engine_version");
    if (!TRUSTED_ENGINE_VERSIONS.includes(envelope.client_engine_version)) {
      throw new BoundaryError("engine_incompatible", { want: TRUSTED_ENGINE_VERSIONS[0], got: envelope.client_engine_version });
    }
  }

  let deadlineMs = null;
  if (operation !== "cancel" && operation !== "capability") {
    deadlineMs = requireSafeInt(requireKey(envelope, "deadline_ms", "envelope"), "envelope.deadline_ms", {
      min: LIMITS.min_deadline_ms,
      max: LIMITS.max_deadline_ms,
    });
  }

  const payload = requireKey(envelope, "payload", "envelope");
  requireOnlyKeys(payload, PAYLOAD_FIELDS[operation], "envelope.payload");
  requireNoAuthority(payload, "envelope.payload");

  if (operation === "capability") {
    if (payload.max_input_bytes !== undefined) {
      requireSafeInt(payload.max_input_bytes, "envelope.payload.max_input_bytes", { min: 1, max: LIMITS.max_input_bytes });
    }
    return { operation, format, deadlineMs, inputs: null };
  }

  if (operation === "cancel") {
    if (payload.reason !== undefined) requireString(payload.reason, "envelope.payload.reason", { maxLength: 512 });
    requireString(requireKey(payload, "job_id", "envelope.payload"), "envelope.payload.job_id");
    return { operation, format, deadlineMs, inputs: null };
  }

  if (operation === "open") {
    requireSafeInt(requireKey(payload, "base_revision", "envelope.payload"), "envelope.payload.base_revision", { min: 0 });
    requireString(requireKey(payload, "base_version_id", "envelope.payload"), "envelope.payload.base_version_id");
    const inputs = validateInputBytes(payload, "envelope.payload", { required: true, byteBound: LIMITS.max_input_bytes });
    if (payload.locale !== undefined) requireString(payload.locale, "envelope.payload.locale", { maxLength: 35 });
    if (payload.edits !== undefined) validateEdits(payload.edits);
    if (payload.document_model_ref !== undefined) requireString(payload.document_model_ref, "envelope.payload.document_model_ref");
    return { operation, format, deadlineMs, inputs };
  }

  if (operation === "edit") {
    validateEdits(requireKey(payload, "edits", "envelope.payload"));
    if (payload.document_model_ref !== undefined) requireString(payload.document_model_ref, "envelope.payload.document_model_ref");
    if (payload.base_revision !== undefined) requireSafeInt(payload.base_revision, "envelope.payload.base_revision", { min: 0 });
    if (payload.base_version_id !== undefined) requireString(payload.base_version_id, "envelope.payload.base_version_id");
    if (payload.locale !== undefined) requireString(payload.locale, "envelope.payload.locale", { maxLength: 35 });
    const inputs = validateInputBytes(payload, "envelope.payload", { required: false, byteBound: LIMITS.max_input_bytes });
    return { operation, format, deadlineMs, inputs, editCount: payload.edits.length };
  }

  if (operation === "convert" || operation === "export") {
    requireString(requireKey(payload, "source_version_id", "envelope.payload"), "envelope.payload.source_version_id");
    const target = requireEnum(requireKey(payload, "target_format", "envelope.payload"), FORMATS, "envelope.payload.target_format");
    if (payload.overwrite_source !== undefined && payload.overwrite_source !== false) {
      throw new ContractViolation("envelope.payload.overwrite_source", "must_be_false", "Q7-B forbids overwriting the committed source");
    }
    return { operation, format, deadlineMs, targetFormat: target, inputs: null };
  }

  if (operation === "serialize") {
    requireString(requireKey(payload, "document_model_ref", "envelope.payload"), "envelope.payload.document_model_ref");
    if (payload.base_revision !== undefined) requireSafeInt(payload.base_revision, "envelope.payload.base_revision", { min: 0 });
    if (payload.base_version_id !== undefined) requireString(payload.base_version_id, "envelope.payload.base_version_id");
    const inputs = validateInputBytes(payload, "envelope.payload", { required: false, byteBound: LIMITS.max_input_bytes });
    return { operation, format, deadlineMs, inputs };
  }

  // Unreachable: requireEnum(OPERATIONS) above already rejected anything else.
  throw new ContractViolation("envelope.operation", "unhandled", operation);
}

// ---------------------------------------------------------------------------
// Injected collaborators (fakes in this file; real ones belong to G1/G2)
// ---------------------------------------------------------------------------

/**
 * A fake object store with the two properties the contract depends on:
 *   * DeleteObject SURFACES its error (server/internal/storage/storage.go's
 *     DeleteObject is exactly 'Delete with the error surfaced'), and
 *   * ObjectURL(key) is a pure function of configuration, so a ledger row can
 *     record the URL before the object exists.
 * deleteFails lets a case make the reconciler fail and prove it retries instead of
 * pretending success.
 */
export function createFakeObjectStore({ deleteFails = false } = {}) {
  const objects = new Map();
  const deleted = [];
  return {
    objects,
    deleted,
    objectUrl(key) { return "memory://office/" + key; },
    put(key, bytes) {
      objects.set(key, Buffer.from(bytes));
      return this.objectUrl(key);
    },
    get(key) {
      if (!objects.has(key)) throw new BoundaryError("object_missing", { object_key: key });
      return objects.get(key);
    },
    has(key) { return objects.has(key); },
    /** Delete with the error surfaced: throws instead of swallowing. */
    deleteObject(key) {
      if (deleteFails) throw new BoundaryError("object_missing", { object_key: key, reason: "delete_failed" });
      if (!objects.has(key)) throw new BoundaryError("object_missing", { object_key: key, reason: "already_absent" });
      objects.delete(key);
      deleted.push(key);
      return true;
    },
  };
}

/**
 * A fake engine. It is INJECTED, not imported: the real engines (docx-engine,
 * pptx-engine, xlsx-gateway, pdf text-edit) are wired by main after the DOC-003
 * repair, and that wiring belongs to task 4.4. This fake can be told to time out,
 * crash, return a wrong checksum, or produce bytes; nothing here runs a real
 * Office engine. It nonetheless keeps the three model operations DISTINGUISHABLE,
 * so a harness can tell an editor model apart from a serialize output:
 *
 *   open      -> the decoded accepted upload, verbatim, as the session model. It is
 *                never invented from document_model_ref or a default label, and it
 *                never carries the serialize prefix.
 *   edit      -> an OBSERVABLE transform: the LAST set_text edit text, or the
 *                documented marker "fake-edit-applied" when no set_text edit is
 *                present. The pre-edit model is never copied through unchanged,
 *                whether or not the job carried its own measured bytes.
 *   serialize -> "engine-output:" + the model the boundary resolved (or its own
 *                frozen accepted bytes for a byte-carrying call). The prefix
 *                belongs to serialize ONLY.
 */
export function createFakeEngine({ now = () => 0 } = {}) {
  /** The one documented fake edit rule: last set_text text, else a fixed marker. */
  function fakeEditResult(edits) {
    const list = Array.isArray(edits) ? edits : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const edit = list[i];
      if (edit && edit.op === "set_text" && typeof edit.text === "string") return edit.text;
    }
    return "fake-edit-applied";
  }
  return {
    /** Returns { bytes, warnings } or throws a BoundaryError. */
    run(request) {
      const payload = request.envelope.payload;
      const operation = request.envelope.operation;
      if (request.behaviour === "timeout") throw new BoundaryError("engine_timeout", { job_id: request.jobId });
      if (request.behaviour === "crash") throw new BoundaryError("engine_crashed", { job_id: request.jobId });
      if (request.behaviour === "overload") throw new BoundaryError("engine_overloaded", { job_id: request.jobId });
      if (request.behaviour === "invalid_result") return { bytes: null, warnings: [] };
      // The engine is handed the RESOLVED model content, never a reference label.
      // A model-reference-only operation that did not resolve a content-carrying
      // model is a boundary bug, not a licence to invent content from a string.
      const modelBytes = request.model && request.model.content_bytes ? Buffer.from(request.model.content_bytes) : null;
      const ownBytes = typeof payload.input_bytes === "string" ? Buffer.from(payload.input_bytes, "base64") : null;
      if (!modelBytes && !ownBytes) {
        throw new BoundaryError("engine_result_invalid", { job_id: request.jobId, reason:
        "model_content_unresolved" });
      }
      // open: the session model IS a copy of the accepted upload. No prefix here.
      if (operation === "open") return { bytes: Buffer.from(ownBytes ?? modelBytes), warnings: request.warnings ?? [] };
      // edit: the ONE documented fake rule runs whether or not the job carried its
      // own measured bytes, so an edit is observable instead of copying the
      // pre-edit model through unchanged.
      if (operation === "edit") return { bytes: Buffer.from(fakeEditResult(payload.edits), "utf8"), warnings:
      request.warnings ?? [] };
      // serialize: a model-reference-only call derives from the resolved model; a
      // byte-carrying call still uses its own frozen accepted bytes.
      const body = Buffer.concat([Buffer.from("engine-output:", "utf8"), modelBytes ?? ownBytes]);
      if (request.behaviour === "length_off_by_one") return { bytes: body, warnings: [], declared_length: body.length + 1 };
      if (request.behaviour === "bad_checksum") {
        const bad = Buffer.from(body); bad[0] = bad[0] ^ 0xff;
        return { bytes: bad, warnings: [], declared_checksum: sha256Bytes(body) };
      }
      return { bytes: body, warnings: request.warnings ?? [] };
    },
  };
}

/**
 * Job ledger. Owned by Go in production; here it is an in-memory structure that
 * survives a simulated process restart iff the caller keeps the same ledger
 * object. It records the intended object URL BEFORE the object exists and moves
 * through intended -> stored -> committed | orphaned -> deleted.
 */
export function createLedger({ objectStore }) {
  const jobs = new Map();
  return {
    jobs,
    record(entry) {
      jobs.set(entry.job_id, {
        attempts: 0,
        last_error: null,
        next_attempt_at: null,
        object_state: "intended",
        ...entry,
      });
      return jobs.get(entry.job_id);
    },
    get(jobId) { return jobs.get(jobId) ?? null; },
    /**
     * Reconcile orphaned objects. Uses DeleteObject and SURFACES its error: a
     * failed delete keeps the row orphaned with a growing attempt count, it never
     * flips to deleted and never drops the row.
     */
    reconcileOrphans() {
      const report = { attempted: 0, deleted: 0, failed: 0, errors: [] };
      for (const job of jobs.values()) {
        if (job.object_state !== "orphaned") continue;
        report.attempted += 1;
        try {
          objectStore.deleteObject(job.object_key);
          job.object_state = "deleted";
          job.last_error = null;
          report.deleted += 1;
        } catch (error) {
          job.attempts += 1;
          job.last_error = error.code;
          report.failed += 1;
          report.errors.push({ job_id: job.job_id, code: error.code });
        }
      }
      return report;
    },
  };
}

// ---------------------------------------------------------------------------
// Fake Go-side document store (versions, revision, commit)
// ---------------------------------------------------------------------------

/**
 * Stands in for the Documents tables Go owns. commitVersion is the single point
 * that moves current_revision and current_version_id, mirroring the real rule
 * that a version row, the current pointer, the revision and the audit/outbox rows
 * commit together. failCommit lets a case drive the DB-side failure the contract
 * promises will leave the current version untouched and the object orphaned.
 */
export function createFakeDocuments({ revision = 7, versionId = "01J8Z0V0000000000000000A" } = {}) {
  return {
    revision,
    versionId,
    versions: [],
    commits: 0,
    rollbacks: 0,
    failCommit: false,
    currentRevision() { return this.revision; },
    currentVersionId() { return this.versionId; },
    commitVersion({ job_id, checksum, length, engine_version, object_key, warnings = [] }) {
      if (this.failCommit) {
        this.rollbacks += 1;
        throw new BoundaryError("object_missing", { job_id, reason: "db_rollback" });
      }
      const version = {
        version_id: "01J8Z0V" + String(this.versions.length + 1).padStart(19, "0"),
        base_version_id: this.versionId,
        revision: this.revision + 1,
        checksum,
        length,
        engine_version,
        object_key,
        warnings,
      };
      this.versions.push(version);
      this.revision = version.revision;
      this.versionId = version.version_id;
      this.commits += 1;
      return version;
    },
  };
}

// ---------------------------------------------------------------------------
// Job grants
// ---------------------------------------------------------------------------

let grantSeq = 0;

/**
 * Issue a scoped, expiring, single-use grant. In production Go mints this and
 * hands it to the engine with the job; the engine never sees a long-lived
 * credential, a storage master key or a business-table connection.
 */
export function issueGrant({ now, ttlMs = 5 * 60 * 1000, ...spec }) {
  grantSeq += 1;
  return {
    grant_id: spec.grant_id ?? "GRANT" + String(grantSeq).padStart(21, "0"),
    actor_id: spec.actor_id ?? "ACTOR-A",
    organization_id: spec.organization_id ?? "ORG-1",
    workspace_id: spec.workspace_id ?? "WS-1",
    document_id: spec.document_id ?? "DOC-1",
    operation: spec.operation ?? "serialize",
    scope: spec.scope ?? "read",
    base_revision: spec.base_revision ?? 7,
    base_version_id: spec.base_version_id ?? "01J8Z0V0000000000000000A",
    issued_at: now(),
    expires_at: spec.expires_at ?? now() + ttlMs,
    single_use: true,
    consumed: false,
    max_output_bytes: spec.max_output_bytes ?? LIMITS.max_output_bytes,
  };
}

/** Fields that bind a grant to one actor, document, operation and base. A caller's
 * copy of a grant is authoritative only if every one of these still matches the
 * registry copy Go issued. */
export const GRANT_BINDING_FIELDS = [
  "actor_id", "organization_id", "workspace_id", "document_id", "operation",
  "scope", "base_revision", "base_version_id", "single_use", "max_output_bytes",
];

/**
 * Authorize a grant use. Order is deliberate: registry existence, authoritative
 * copy, single-use consumption, expiry, actor, then document / operation / base
 * identity and scope. Authorization is modelled in memory here - it is NOT product
 * tenant isolation - but the trusted registry IS the authority: when a registry is
 * supplied, the caller's grant object is only a handle and any field it changed is
 * refused, so a caller-minted or mutated grant can never become engine authority.
 */
export function authorizeGrant(grant, { actorId, operation, job, now, registry } = {}) {
  if (!grant || typeof grant.grant_id !== "string") throw new BoundaryError("not_found", { reason: "unknown_grant" });
  const trusted = registry ? registry.get(grant.grant_id) : grant;
  if (!trusted) throw new BoundaryError("not_found", { reason: "unregistered_grant", grant_id: grant.grant_id });
  if (registry) {
    for (const field of GRANT_BINDING_FIELDS) {
      if (grant[field] !== trusted[field]) {
        throw new BoundaryError("grant_actor_mismatch", { grant_id: grant.grant_id, field, reason: "grant_not_authoritative" });
      }
    }
  }
  if (trusted.single_use && trusted.consumed) throw new BoundaryError("grant_consumed", { grant_id: trusted.grant_id });
  if (now() >= trusted.expires_at) throw new BoundaryError("grant_expired", { grant_id: trusted.grant_id });
  if (trusted.actor_id !== actorId) throw new BoundaryError("grant_actor_mismatch", { grant_id: trusted.grant_id });
  if (job) {
    // A grant is bound to one scope, so its organization and workspace must match
    // the job too. Comparing only document/operation/base let a registry row that
    // still matched the handle authorize a job in another org/workspace.
    if (trusted.organization_id !== job.organization_id) {
      throw new BoundaryError("grant_scope", { grant_id: trusted.grant_id, reason: "organization_mismatch", grant_organization_id: trusted.organization_id });
    }
    if (trusted.workspace_id !== job.workspace_id) {
      throw new BoundaryError("grant_scope", { grant_id: trusted.grant_id, reason: "workspace_mismatch", grant_workspace_id: trusted.workspace_id });
    }
    if (trusted.document_id !== job.document_id) {
      throw new BoundaryError("grant_scope", { grant_id: trusted.grant_id, reason: "document_mismatch", grant_document_id: trusted.document_id });
    }
    if (trusted.operation !== job.operation) {
      throw new BoundaryError("grant_scope", { grant_id: trusted.grant_id, reason: "operation_mismatch", grant_operation: trusted.operation,
      job_operation: job.operation });
    }
    if (trusted.base_revision !== job.base_revision) {
      throw new BoundaryError("grant_scope", { grant_id: trusted.grant_id, reason: "base_revision_mismatch", grant_base_revision:
      trusted.base_revision });
    }
    if (trusted.base_version_id !== job.base_version_id) {
      throw new BoundaryError("grant_scope", { grant_id: trusted.grant_id, reason: "base_version_id_mismatch" });
    }
  }
  if (trusted.scope !== "write_branch" && operation !== "capability" && operation !== "open") {
    throw new BoundaryError("grant_scope", { grant_id: trusted.grant_id, scope: trusted.scope, operation });
  }
  return trusted;
}

/**
 * Consume a single-use grant at the one-attempt / one-commit point. When a
 * registry is supplied the REGISTRY copy is consumed, so the caller's handle stays
 * unchanged and a second attempt is refused as grant_consumed.
 */
export function consumeGrant(grant, registry) {
  const target = registry && grant ? registry.get(grant.grant_id) ?? grant : grant;
  if (!target) throw new BoundaryError("not_found", { reason: "unknown_grant" });
  if (target.single_use && target.consumed) throw new BoundaryError("grant_consumed", { grant_id: target.grant_id });
  target.consumed = true;
  return target;
}

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/**
 * createBoundary wires the fake collaborators into the contract the doc
 * specifies. Everything it enforces is what Go enforces in production; nothing
 * it enforces is product auth, tenancy or storage durability. The engine is
 * injected so main can pass a real adapter later without touching this file's
 * contract surface.
 */
export function createBoundary({ now = () => 0, engine, objectStore, documents, ledger } = {}) {
  const store = objectStore ?? createFakeObjectStore();
  const docs = documents ?? createFakeDocuments();
  const book = ledger ?? createLedger({ objectStore: store });
  const eng = engine ?? createFakeEngine({ now });

  /** job_id -> job. Survives a simulated restart because callers keep the boundary. */
  const jobs = new Map();
  /** (actor|scope|key) -> { fingerprint, job_id, actor_id } */
  const idempotency = new Map();
  /**
   * Trusted registries. These are the authority run() enforces; none of them can
   * be reached or overwritten from an envelope. Production Go owns the equivalents.
   */
  const actorRegistry = new Map([
    ["ACTOR-A", { organization_id: "ORG-1", workspace_id: "WS-1", document_id: "DOC-1" }],
    ["ACTOR-B", { organization_id: "ORG-1", workspace_id: "WS-1", document_id: "DOC-2" }],
  ]);
  /** grant_id -> the grant record Go issued (never the caller's copy). */
  const grantRegistry = new Map();
  /**
   * document_model_ref -> the trusted scoped model record. It carries the ACTUAL
   * content bytes the model was established from, the account/org/workspace/
   * document/actor scope, and the accepted job + fingerprint it is bound to, so a
   * serialize resolves content instead of a reference label and a later
   * replacement (or in-place mutation) of the handle or its content is detectable.
   * The Map stays exposed as a trusted test fixture (like jobs and grantRegistry).
   */
  const modelRegistry = new Map();
  let jobSeq = 0;
  let engineAvailable = true;

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }  /** Freeze a private copy of any accepted value so a later mutation of the
   * caller's object cannot change engine input, output identity or warnings. */
  function cloneAccepted(value) { return deepFreeze(structuredClone(value ?? null)); }
  /** Freeze a private, normalized copy of the accepted envelope so a later
   * mutation of the caller's object cannot bypass validation or the fingerprint. */
  function cloneEnvelope(envelope) { return cloneAccepted(envelope); }

  /**
   * The unforgeable acceptance record: job_id -> the registered job, its frozen
   * accepted envelope and the metadata run() must not re-derive from a caller
   * object. Only submit() writes here, and it stays private on purpose. This is
   * model-API hardening, NOT a production ACL: the exposed Maps (jobs,
   * grantRegistry, modelRegistry) are trusted harness facilities a test uses to
   * inject authority, not wire inputs.
   */
  const authorityRegistry = new Map();

  function registerAcceptedJob(job, { accepted_content = null, accepted_model = null } = {}) {
    authorityRegistry.set(job.job_id, {
      job,
      envelope: job.envelope,
      actor_id: job.actor_id,
      operation: job.operation,
      format: job.format,
      organization_id: job.organization_id,
      workspace_id: job.workspace_id,
      document_id: job.document_id,
      base_revision: job.base_revision,
      base_version_id: job.base_version_id,
      deadline_ms: job.deadline_ms,
      accepted_at: job.accepted_at,
      behaviour: job.behaviour,
      accepted_input: job.accepted_input,
      declared_warnings: job.declared_warnings,
      // Private, never re-derived from a caller object: the measured content a job
      // with its own input ran on, and - for a model-reference-only job - the shape
      // of the model record it was accepted against.
      accepted_content,
      accepted_model,
    });
  }

  /**
   * The content-carrying model registration contract. `bytes` is the ACTUAL
   * document content (never a reference string, never checksum metadata), and the
   * record is bound to the accepted job + fingerprint and to the job's
   * account/org/workspace/document/actor scope. A trusted harness that seeds
   * modelRegistry directly must supply this shape.
   */
  function registerModelContent(ref, job, bytes) {
    if (!ref) return null;
    const content = Buffer.from(bytes);
    const record = {
      actor_id: job.actor_id,
      organization_id: job.organization_id,
      workspace_id: job.workspace_id,
      document_id: job.document_id,
      job_id: job.job_id,
      fingerprint: job.fingerprint,
      content_bytes: content,
      content_checksum: sha256Bytes(content),
      content_length: content.length,
    };
    modelRegistry.set(ref, record);
    return record;
  }

  const record = () => {
    const list = [...jobs.values()];
    return {
      jobs: list,
      job_count: list.length,
      settled: list.filter((j) => j.settled).length,
      current_revision: docs.currentRevision(),
      current_version_id: docs.currentVersionId(),
      versions: docs.versions.length,
      ledger: [...book.jobs.values()],
      objects: [...store.objects.keys()],
    };
  };

  /**
   * The single linearization point. Whoever calls settle first wins; a second
   * caller gets the SAME state back and cannot change it. This is what makes
   * cancel-vs-complete deterministic instead of a race whose loser silently
   * overwrites the winner.
   */
  function settle(job, candidate) {
    if (!JOB_STATES.includes(candidate)) throw new BoundaryError("invalid_transition", { to: candidate });
    if (job.settled && job.state !== candidate) {
      throw new BoundaryError("invalid_transition", { job_id: job.job_id, from: job.state, to: candidate });
    }
    if (job.settled) return job.state;
    job.state = candidate;
    job.settled = true;
    job.settled_at = now();
    return job.state;
  }

  function fingerprintKey(envelope, actorId) {
    return [actorId, envelope.operation, envelope.idempotency_key ?? "<none>"].join("|");
  }

  function requireSettledAs(job, expected, operation) {
    if (!job) throw new BoundaryError("not_found", { reason: "unknown_job" });
    if (job.settled && job.state !== expected) {
      throw new BoundaryError("invalid_transition", { job_id: job.job_id, from: job.state, operation });
    }
  }

  /**
   * Validate, deduplicate and accept a job. Validation happens BEFORE a grant or
   * job exists, so a malformed or lying request cannot move the revision or touch
   * bytes. The fingerprint uses the MEASURED digest and length, not the declared
   * ones, and the accepted envelope is frozen so later mutation cannot bypass it.
   */
  function submit(envelope, { actorId = "ACTOR-A", behaviour = "ok" } = {}) {
    const actor = actorRegistry.get(actorId);
    if (!actor) throw new BoundaryError("not_found", { reason: "unknown_actor", actor_id: actorId });
    const checked = validateEnvelope(envelope);
    const fingerprint = payloadFingerprint(envelope, { inputs: checked.inputs });
    const key = fingerprintKey(envelope, actorId);

    if (envelope.idempotency_key) {
      const prior = idempotency.get(key);
      if (prior) {
        if (prior.actor_id !== actorId) throw new BoundaryError("job_conflict", { key: envelope.idempotency_key });
        if (prior.fingerprint !== fingerprint) {
          throw new BoundaryError("payload_fingerprint_mismatch", { key: envelope.idempotency_key });
        }
        const existing = jobs.get(prior.job_id);
        if (existing && !existing.settled) throw new BoundaryError("in_flight", { job_id: existing.job_id });
        existing.replayed = (existing.replayed ?? 0) + 1;
        return { job: existing, replay: true, fingerprint };
      }
    }

    jobSeq += 1;
    const job = {
      job_id: "JOB" + String(jobSeq).padStart(23, "0"),
      operation: checked.operation,
      format: checked.format,
      actor_id: actorId,
      organization_id: actor.organization_id,
      workspace_id: actor.workspace_id,
      document_id: actor.document_id,
      idempotency_key: envelope.idempotency_key ?? null,
      fingerprint,
      state: "accepted",
      settled: false,      settled_at: null,
      deadline_ms: checked.deadlineMs,
      // Trusted acceptance instant, captured once at submit. The accepted deadline
      // is accepted_at + deadline_ms and a replay returns THIS job, so a retry can
      // never slide the window forward.
      accepted_at: now(),
      behaviour,
      envelope: cloneEnvelope(envelope),
      accepted_input: cloneAccepted(checked.inputs ? { checksum: checked.inputs.checksum, length:
      checked.inputs.length } : null),
      declared_warnings: cloneAccepted(envelope.declared_warnings ?? []),
      base_revision: envelope.payload ? envelope.payload.base_revision ?? null : null,
      base_version_id: envelope.payload ? envelope.payload.base_version_id ?? null : null,
      output_key: null,
      output_checksum: null,
      output_length: null,
      warnings: [],
      grant: null,
    };    jobs.set(job.job_id, job);
    const modelRef = envelope.payload ? envelope.payload.document_model_ref : null;
    // submit NEVER writes the shared trusted model map. A caller-chosen
    // document_model_ref is a REQUEST, not authority: writing modelRegistry[ref]
    // here let a grantless submit replace an established session model before run
    // (an owner-vs-owner clobber, since refs are guessable `engine-session:<job>`).
    // A byte-carrying job is self-contained - its content rides on accepted_content
    // and is handed to the engine as-is. The trusted map is written only by run(),
    // under a SERVER-MINTED `engine-session:<job_id>` ref, from the engine's own
    // produced bytes, so a caller can neither establish nor replace a trusted record.
    // A model-reference-only job snapshots the record it is accepted against, so a
    // later replacement (or in-place mutation) cannot change what it serializes.
    const acceptedContent = checked.inputs && checked.inputs.bytes ? Buffer.from(checked.inputs.bytes) : null;
    let acceptedModel = null;
    if (modelRef && !acceptedContent && (checked.operation === "serialize" || checked.operation === "edit")) {
      const existing = modelRegistry.get(modelRef);
      acceptedModel = existing ? { ref: modelRef, job_id: existing.job_id, fingerprint: existing.fingerprint ??
      null,
      content_checksum: existing.content_checksum ?? null, content_length: existing.content_length ?? null } : null;
    }
    registerAcceptedJob(job, { accepted_content: acceptedContent, accepted_model: acceptedModel });
    if (envelope.idempotency_key) {
      idempotency.set(key, { fingerprint, job_id: job.job_id, actor_id: actorId });
    }
    return { job, replay: false, fingerprint };
  }

  /** Catalogue an operation answers for capability without touching storage. */
  function capabilityFor(format) {
    return {
      format,
      capabilities: OPERATIONS.filter((op) => op !== "cancel").map((op) => ({
        operation: op,
        supported: op !== "convert" && op !== "export",
        runtime: "worker",
        evidence_level: "pending",
      })),
      limits: { max_input_bytes: LIMITS.max_input_bytes, max_edit_ops: LIMITS.max_edit_ops },
    };
  }

  /**
   * Resolve the content a serialize/edit job must run on; null for an operation
   * that carries no model.
   *
   * A job with its own measured bytes is self-contained: its content IS those
   * bytes. A model-reference-only job resolves the trusted scoped model record and
   * must still match the shape snapshotted at submit. The digest and length are
   * RECOMPUTED from the live content_bytes, not read back from the stored fields,
   * so an in-place mutation of the same Buffer is refused too. Arbitrary caller
   * text is never treated as content, and content is never synthesized from
   * checksum metadata.
   */
  function resolveModelOrThrow(job, accepted) {
    if (job.operation !== "serialize" && job.operation !== "edit") return null;
    const ref = job.envelope.payload ? job.envelope.payload.document_model_ref : null;
    const ownBytes = accepted ? accepted.accepted_content : null;
    if (ownBytes) {
      return { ref: ref ?? null, job_id: job.job_id, fingerprint: job.fingerprint, content_bytes:
      Buffer.from(ownBytes) };
    }
    const model = ref ? modelRegistry.get(ref) : null;
    const inScope = model && model.actor_id === job.actor_id && model.document_id === job.document_id
      && model.organization_id === job.organization_id && model.workspace_id === job.workspace_id;
    if (!inScope || !model.content_bytes) {
      throw new BoundaryError("not_found", { job_id: job.job_id, reason: "unresolved_model_reference",
      document_model_ref: ref ?? null });
    }
    const bound = accepted ? accepted.accepted_model : null;
    if (!bound) {
      throw new BoundaryError("not_found", { job_id: job.job_id, reason: "unresolved_model_reference",
      document_model_ref: ref ?? null });
    }
    const measured = sha256Bytes(model.content_bytes);
    if (bound.job_id !== model.job_id || bound.fingerprint !== model.fingerprint
        || bound.content_length !== model.content_bytes.length || bound.content_checksum !== measured) {
      throw new BoundaryError("payload_fingerprint_mismatch", { job_id: job.job_id, reason: "model_binding_drift",
      document_model_ref: ref ?? null });
    }
    return { ref, job_id: model.job_id, fingerprint: model.fingerprint, content_bytes:
    Buffer.from(model.content_bytes) };
  }  /**
   * Run a job to a settled state and perform the OPERATION'S effect.
   *
   * The order is authenticate -> authorize -> resolve model -> consume -> effect.
   * Handle resolution comes FIRST: the caller object is a HANDLE, not authority.
   * The registered job and its frozen accepted envelope/metadata are the only
   * source of truth, so an unknown, copied or field-mutated handle is refused
   * before any mutation, engine call or grant consumption. The accepted model is
   * then resolved - and its binding re-checked - BEFORE the single-use grant is
   * consumed, so a replaced handle or content cannot burn the grant or change the
   * committed bytes. Authorization is not optional:
   * every job that reaches the engine needs a registered single-use grant whose
   * document, operation and base identity match this job. Only the operations
   * whose contract defines a durable write reach the object-put and commit path:
   * serialize performs the guarded immutable version commit. open and edit change
   * session/model state and never create a version, capability is a pure catalogue
   * read, and convert/export - not modelled here - refuse by name instead of being
   * routed through the commit path.
   *
   * The exposed Maps (jobs, grantRegistry, modelRegistry) are trusted harness
   * facilities a test uses to inject authority; they are NOT wire inputs and this
   * is not a production ACL. The registry comparison hardens the model API against
   * a caller-supplied object, nothing more.
   */
  function run(handle, { actorId, grant, cause = "engine" } = {}) {
    if (!handle) throw new BoundaryError("not_found", { reason: "unknown_job" });
    const job = jobs.get(handle.job_id ?? null);
    if (!job) throw new BoundaryError("not_found", { reason: "unknown_job", job_id: handle.job_id ?? null });
    const accepted = authorityRegistry.get(job.job_id);
    if (!accepted || accepted.job !== handle || accepted.envelope !== handle.envelope
        || accepted.actor_id !== handle.actor_id || accepted.operation !== handle.operation
        || accepted.format !== handle.format || accepted.organization_id !== handle.organization_id
        || accepted.workspace_id !== handle.workspace_id
        || accepted.document_id !== handle.document_id || accepted.base_revision !== handle.base_revision
        || accepted.base_version_id !== handle.base_version_id || accepted.deadline_ms !== handle.deadline_ms
        || accepted.accepted_at !== handle.accepted_at || accepted.behaviour !== handle.behaviour
        || accepted.accepted_input !== handle.accepted_input
        || accepted.declared_warnings !== handle.declared_warnings) {
      throw new BoundaryError("payload_fingerprint_mismatch", { job_id: job.job_id, reason:
      "unaccepted_job_handle" });
    }
    const effectiveActor = actorId ?? job.actor_id;
    if (job.settled) {
      if (effectiveActor !== job.actor_id) throw new BoundaryError("grant_actor_mismatch", { job_id: job.job_id,
      actor_id: effectiveActor });
      return job;
    }
    if (effectiveActor !== job.actor_id) {
      throw new BoundaryError("grant_actor_mismatch", { job_id: job.job_id, actor_id: effectiveActor, owner_actor_id:
      job.actor_id });
    }

    // H1: the accepted deadline is accepted_at + deadline_ms, recorded once at
    // submit. It is enforced from the trusted clock BEFORE any engine work, object
    // write, version commit or grant consumption, and a replay returns this same
    // accepted job, so the window can never slide forward. cause=timeout/crash stay
    // explicit test injections and are not the deadline arithmetic.
    if (cause !== "timeout" && cause !== "crash" && job.deadline_ms !== null
        && now() >= job.accepted_at + job.deadline_ms) {
      settle(job, "timed_out");
      job.error = new BoundaryError("engine_timeout", { job_id: job.job_id, deadline_ms: job.deadline_ms }).toJSON();
      return job;
    }
    job.state = "running";

    if (cause === "crash") {
      settle(job, "crashed");
      job.error = new BoundaryError("engine_crashed", { job_id: job.job_id }).toJSON();
      return job;
    }
    if (cause === "timeout") {
      settle(job, "timed_out");
      job.error = new BoundaryError("engine_timeout", { job_id: job.job_id }).toJSON();
      return job;
    }

    // capability is a catalogue read: no engine, no grant, no object, no version.
    if (job.operation === "capability") {
      settle(job, "completed");
      job.capability = capabilityFor(accepted.format);
      return job;
    }

    // Operations this reference model does not implement refuse by NAME. Routing
    // them through the serialize commit path was the defect.
    if (job.operation === "convert" || job.operation === "export") {
      settle(job, "failed");
      job.error = new BoundaryError("unsupported_operation", { job_id: job.job_id, operation: job.operation }).toJSON();
      return job;
    }

    let produced;
    let resolvedModel = null;
    try {
      if (!engineAvailable) throw new BoundaryError("engine_crashed", { reason: "engine_unavailable" });
      authorizeGrant(grant, { actorId: effectiveActor, operation: job.operation, job, now, registry: grantRegistry });
      // Resolve the accepted model BEFORE consuming the single-use grant, so a
      // replaced handle or content is refused without burning the grant, and hand
      // the engine the ACTUAL content instead of a reference label.
      resolvedModel = resolveModelOrThrow(job, accepted);
      consumeGrant(grant, grantRegistry);
      produced = eng.run({ envelope: job.envelope, jobId: job.job_id, behaviour: job.behaviour, warnings:
      accepted.declared_warnings, model: resolvedModel });
      // The grant's max_output_bytes is a real ceiling, not decoration: a produced
      // payload over it refuses BEFORE any object or version, so the ceiling cannot
      // be bypassed by a grant that otherwise authorizes the write. The attempt is
      // already consumed (one attempt per grant); a retry needs a fresh grant.
      if (produced && produced.bytes) {
        const ceiling = grantRegistry.get(grant.grant_id)?.max_output_bytes;
        if (typeof ceiling === "number" && produced.bytes.length > ceiling) {
          throw new BoundaryError("upload_bounds", { job_id: job.job_id, reason: "grant_max_output_bytes", produced_length:
          produced.bytes.length, max_output_bytes: ceiling });
        }
      }
    } catch (error) {
      settle(job, error.code === "engine_timeout" ? "timed_out" : "failed");
      job.error = (error instanceof BoundaryError ? error : new BoundaryError("engine_crashed", { reason: "engine_threw" })).toJSON();
      return job;
    }

    if (!produced || !produced.bytes) {
      settle(job, "failed");
      job.error = new BoundaryError("engine_result_invalid", { job_id: job.job_id }).toJSON();
      return job;
    }

    // open / edit register the model they PRODUCED for subsequent model-reference
    // operations, from a private copy of the engine result: the contract says open
    // returns an editor model (SS4.3) and edit applies changes onto that session
    // model (SS4.4). Registering the input the job ran on, or a reference label,
    // made both sentences false - a truthful later serialize then committed the
    // pre-edit bytes. Checksum and length on the record are measured from these
    // produced bytes.
    if (job.operation !== "serialize") {
      const modelRef = "engine-session:" + job.job_id;
      registerModelContent(modelRef, job, produced.bytes);
      job.document_model_ref = modelRef;
      job.warnings = produced.warnings ?? [];
      settle(job, "completed");
      return job;
    }

    if (!produced || !produced.bytes) {
      settle(job, "failed");
      job.error = new BoundaryError("engine_result_invalid", { job_id: job.job_id }).toJSON();
      return job;
    }

    const bytes = Buffer.from(produced.bytes);
    // Declared checksum and length are checked on this private copy BEFORE any
    // ledger row, object put, or version commit. A mismatch stores nothing: no
    // object key, no orphan, revision and current version pointer unchanged.
    // Grant consumption above is unchanged. Commit-failure orphans stay below.
    const recomputed = sha256Bytes(bytes);
    if (produced.declared_checksum && produced.declared_checksum !== recomputed) {
      settle(job, "failed");
      job.error = new BoundaryError("engine_checksum_mismatch", { job_id: job.job_id, recomputed }).toJSON();
      return job;
    }
    if (produced.declared_length !== undefined && produced.declared_length !== bytes.length) {
      settle(job, "failed");
      job.error = new BoundaryError("engine_result_invalid", { job_id: job.job_id, recomputed }).toJSON();
      return job;
    }

    const outputKey = "office/jobs/" + job.job_id + "/" + accepted.format + ".out";
    // Object is put BEFORE any DB commit. The ledger records the intended URL
    // first, exactly as Storage.ObjectURL lets the media ledger do today.
    book.record({ job_id: job.job_id, object_key: outputKey, object_state: "intended" });
    store.put(outputKey, bytes);
    job.output_key = outputKey;
    book.get(job.job_id).object_state = "stored";

    // (3) The only place revision/current pointer move. If it fails, the object
    // is an orphan and the current version is untouched.
    try {
      if (job.base_revision !== null && job.base_revision !== docs.currentRevision()) {
        throw new BoundaryError("base_version_mismatch", { got: job.base_revision, want: docs.currentRevision() });
      }
      const version = docs.commitVersion({
        job_id: job.job_id,
        checksum: recomputed,
        length: bytes.length,
        engine_version: job.envelope.client_engine_version,
        object_key: outputKey,
        warnings: produced.warnings ?? [],
      });
      job.output_key = outputKey;
      job.output_checksum = recomputed;
      job.output_length = bytes.length;
      job.warnings = produced.warnings ?? [];
      job.version_id = version.version_id;
      book.get(job.job_id).object_state = "committed";
      settle(job, "completed");
      return job;
    } catch (error) {
      book.get(job.job_id).object_state = "orphaned";
      settle(job, "failed");
      job.error = error instanceof BoundaryError ? error.toJSON() : new BoundaryError("commit_failed", {}).toJSON();
      return job;
    }
  }

  /**
   * Cancel a job. Deterministic: if the job already settled completed, cancel
   * CANNOT undo the commit and reports the truth. If it settles cancelled, a late
   * engine result is discarded by the caller because the job is settled. Actor and
   * job ownership are checked BEFORE any state mutation: a foreign actor cannot
   * cancel a job it does not own.
   */
  function cancel(envelope, { actorId = "ACTOR-A" } = {}) {
    if (!actorRegistry.has(actorId)) throw new BoundaryError("not_found", { reason: "unknown_actor", actor_id: actorId });
    validateEnvelope(envelope);
    const jobId = envelope.payload.job_id;
    const job = jobs.get(jobId);
    if (!job) throw new BoundaryError("not_found", { reason: "unknown_job", job_id: jobId });
    if (actorId !== job.actor_id) {
      throw new BoundaryError("grant_actor_mismatch", { job_id: jobId, actor_id: actorId, owner_actor_id: job.actor_id });
    }
    const prior = job.state;
    // Linearization: whoever settles first wins. A settled job keeps its state;
    // cancel reports the truth and cannot undo a commit it lost the race to.
    const state = job.settled ? job.state : settle(job, "cancelled");
    return { job, state, previous_state: prior, linearized: state === "cancelled", already_committed: state === "completed" };
  }

  /** Apply a late engine result to a possibly-settled job. A cancelled job keeps
   * its output out of the store's committed set: the result is discarded. */
  function applyLateResult(job) {
    if (job.settled) return { applied: false, state: job.state };
    return { applied: true, state: run(job).state };
  }

  /**
   * Reload a job after a simulated process restart. A job that was running when
   * the process died becomes crashed; it is never silently resumed, because a
   * resumed engine write could commit bytes no one asked for. A completed job
   * keeps its result and replays under the same key.
   */
  function recoverJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) throw new BoundaryError("not_found", { reason: "unknown_job", job_id: jobId });
    if (!job.settled) {
      if (job.state === "running" || job.state === "accepted") {
        settle(job, "crashed");
        job.error = new BoundaryError("engine_crashed", { job_id: jobId, reason: "recovered_after_restart" }).toJSON();
      }
    }
    return job;
  }
  /**
   * The document list does not go through the engine. With the engine down it
   * still answers; this models the contract rule that metadata and the original
   * bytes stay reachable when the engine is unavailable.
   */
  function listDocuments() {
    return [{ document_id: "DOC-1", current_revision: docs.currentRevision(), current_version_id: docs.currentVersionId() }];
  }

  /** The original committed bytes are readable without the engine. */
  function readOriginal(documentId) {
    if (documentId !== "DOC-1") return null;
    return Buffer.from("fixture-docx-bytes", "utf8");
  }

  /**
   * The projection a browser is allowed to see. It deliberately carries ids,
   * counts and a checksum - never a path, a private storage key or a credential.
   * no-path-in-browser-result scans this object for leaks.
   */
  function browserProjection(job) {
    return {
      job_id: job.job_id,
      state: job.state,
      operation: job.operation,
      format: job.format,
      version_id: job.version_id ?? null,
      output_checksum: job.output_checksum,
      output_length: job.output_length,
      warnings: job.warnings,
    };
  }
  function setEngineAvailable(value) { engineAvailable = value; }

  /** Recompute the input checksum from the ACTUAL bytes with the same strict
   * decode, bound and length checks validateEnvelope uses. Kept as a callable so a
   * caller can pre-flight, but the boundary no longer relies on it: submit/run
   * validate through validateEnvelope, before any job or object exists. */
  function verifyInputChecksum(envelope) {
    const inputs = validateInputBytes(envelope.payload ?? {}, "envelope.payload", { required: true, byteBound: LIMITS.max_input_bytes });
    return { measured: inputs.checksum, length: inputs.length };
  }

  /** Register a grant in the trusted registry. The registry keeps its own record;
   * the object returned to the caller is only a handle. */
  function registerGrant(spec) {
    const grant = issueGrant(spec);
    grantRegistry.set(grant.grant_id, { ...grant });
    return grant;
  }

  /** Mint the scoped grant a job runs under. Production Go issues this; the
   * engine never holds a long-lived credential or a business-table connection. */
  function grantFor(job, { scope = "write_branch", ttlMs } = {}) {
    const grant = registerGrant({
      now,
      actor_id: job.actor_id,
      organization_id: job.organization_id,
      workspace_id: job.workspace_id,
      document_id: job.document_id,
      operation: job.operation,
      scope,
      base_revision: job.base_revision ?? docs.currentRevision(),
      base_version_id: job.base_version_id ?? docs.currentVersionId(),
      ...(ttlMs === undefined ? {} : { ttlMs }),
    });
    job.grant = grant;
    return grant;
  }

  /** A read-scope grant for operations that never write a branch. */
  function readGrantFor(job) { return grantFor(job, { scope: "read" }); }
  return { jobs, store, docs, book, actorRegistry, grantRegistry, modelRegistry, settle, submit, run, cancel, applyLateResult, recoverJob,
  verifyInputChecksum, grantFor, readGrantFor, listDocuments, readOriginal, browserProjection, record, setEngineAvailable, fingerprintOf:
  payloadFingerprint };
}

// ---------------------------------------------------------------------------
// Fault cases with literal oracles
// ---------------------------------------------------------------------------

const B64 = (s) => Buffer.from(s, "utf8").toString("base64");

function baseEnvelope(overrides = {}) {
  const bytes = Buffer.from("fixture-docx-bytes", "utf8");
  return {
    request_id: "REQ0000000000000000000001",
    contract_version: CONTRACT_VERSION,
    protocol_version: PROTOCOL_VERSION,
    operation: "open",
    format: "docx",
    deadline_ms: 30000,
    idempotency_key: "IDEMP-1",
    client_engine_version: "genoffice@09485f88+uniwork-office.0",
    payload: {
      input_bytes: B64("fixture-docx-bytes"),
      input_checksum: sha256Bytes(bytes),
      input_length: bytes.length,
      base_revision: 7,
      base_version_id: "01J8Z0V0000000000000000A",
      edits: [{ op: "set_text", target: { block_index: 3 }, text: "UniWork Office" }],
    },
    ...overrides,
  };
}

function cancelEnvelope(jobId, overrides = {}) {
  return { request_id: "REQ0000000000000000000002", contract_version: CONTRACT_VERSION, protocol_version: PROTOCOL_VERSION, operation: "cancel", format: "docx", deadline_ms: 30000, payload: { job_id: jobId }, ...overrides };
}

/**
 * Every mandatory case from the contract doc, with its oracle written literally.
 * A case is a REAL situation the boundary must answer, not an impossible call the
 * harness is free to answer with a crash. Each case ends by CONVERGING: after the
 * failure the model reads state again and must answer, so a failure that leaves
 * the boundary unusable is caught here.
 */
export const FAULT_CASES = [
  {
    id: "malformed-missing-format",
    requirement: "a request without format is rejected before a job exists",
    expect: { kind: "contract_violation", field_path: "envelope.format", revision_delta: 0, jobs: 0 },
    run: (b) => {
      const env = baseEnvelope(); delete env.format;
      let error = null; try { b.submit(env); } catch (e) { error = e; }
      return { error, snapshot: b.record() };
    },
  },
  {
    id: "malformed-unknown-operation",
    requirement: "an operation outside the catalogue is rejected",
    expect: { kind: "contract_violation", field_path: "envelope.operation", revision_delta: 0, jobs: 0 },
    run: (b) => { const env = baseEnvelope({ operation: "explode" }); let error = null; try { b.submit(env); } catch (e) { error = e; } return { error, snapshot: b.record() }; },
  },
  {
    id: "malformed-float-length",
    requirement: "input_length must be a safe integer, not a float",
    expect: { kind: "contract_violation", field_path: "envelope.payload.input_length", revision_delta: 0, jobs: 0 },
    run: (b) => { const env = baseEnvelope(); env.payload.input_length = 12.5; let error = null; try { b.submit(env); } catch (e) { error = e; } return { error, snapshot: b.record() }; },
  },
  {
    id: "malformed-negative-deadline",
    requirement: "a deadline below the minimum is rejected",
    expect: { kind: "contract_violation", field_path: "envelope.deadline_ms", revision_delta: 0, jobs: 0 },
    run: (b) => { const env = baseEnvelope({ deadline_ms: -1 }); let error = null; try { b.submit(env); } catch (e) { error = e; } return { error, snapshot: b.record() }; },
  },
  {
    id: "malformed-oversize-input",
    requirement: "a DECLARED input_length above the byte bound is a schema violation before a job exists (actual bytes over the bound are upload_bounds)",
    expect: { kind: "contract_violation", field_path: "envelope.payload.input_length", revision_delta: 0, jobs: 0 },
    run: (b) => { const env = baseEnvelope(); env.payload.input_length = LIMITS.max_input_bytes + 1; let error = null; try { b.submit(env); } catch (e) { error = e; } return { error, snapshot: b.record() }; },
  },
  {
    id: "malformed-bad-checksum-hex",
    requirement: "a checksum that is not 64 lowercase hex is rejected",
    expect: { kind: "contract_violation", field_path: "envelope.payload.input_checksum", revision_delta: 0, jobs: 0 },
    run: (b) => { const env = baseEnvelope(); env.payload.input_checksum = "NOT-A-CHECKSUM"; let error = null; try { b.submit(env); } catch (e) { error = e; } return { error, snapshot: b.record() }; },
  },
  {
    id: "contract-version-mismatch",
    requirement: "a different contract_version is refused as a schema violation before a job exists",
    expect: { kind: "contract_violation", field_path: "envelope.contract_version", revision_delta: 0, jobs: 0 },
    run: (b) => { const env = baseEnvelope({ contract_version: "uniwork-office-engine-contract/999" }); let error = null; try { b.submit(env); } catch (e) { error = e; } return { error, snapshot: b.record() }; },
  },
  {
    id: "protocol-version-mismatch",
    requirement: "an unsupported protocol_version is refused rather than negotiated down",
    expect: { kind: "contract_violation", field_path: "envelope.protocol_version", revision_delta: 0, jobs: 0 },
    run: (b) => { const env = baseEnvelope({ protocol_version: 2 }); let error = null; try { b.submit(env); } catch (e) { error = e; } return { error, snapshot: b.record() }; },
  },
  {
    id: "engine-version-incompatible-is-typed",
    requirement: "an untrusted client_engine_version is refused by submit with a typed engine_incompatible, before a job exists",
    expect: { code: "engine_incompatible", status: 409, error_class: "incompatible", retryable: false, jobs: 0, revision_delta: 0 },
    run: (b) => {
      const env = baseEnvelope({ client_engine_version: "genoffice@0000000+uniwork-office.0" });
      let error = null;
      try { b.submit(env); } catch (e) { error = e; }
      return { error, snapshot: b.record() };
    },
  },
  {
    id: "input-checksum-mismatch",
    requirement: "submit refuses a lying declared digest, and a declared length that disagrees with the decoded bytes, before any job exists",
    expect: { code: "upload_checksum_mismatch", status: 409, revision_delta: 0, objects: 0, jobs: 0 },
    run: (b) => {
      const lyingDigest = baseEnvelope();
      lyingDigest.payload.input_checksum = sha256Bytes(Buffer.from("different-bytes", "utf8"));
      let error = null;
      try { b.submit(lyingDigest); } catch (e) { error = e; }
      // A declared length that disagrees with the ACTUAL decoded bytes shares this refusal.
      const lyingLength = baseEnvelope({ request_id: "REQ0000000000000000000004", idempotency_key: "IDEMP-CHK-2" });
      lyingLength.payload.input_length = lyingLength.payload.input_length + 1;
      try { b.submit(lyingLength); } catch (e) { error = e; }
      return { error, snapshot: b.record() };
    },
  },
  {
    id: "output-checksum-recomputed",
    requirement: "Go recomputes the checksum from the bytes and commits the value it measured",
    expect: { state: "completed", checksum_equals_bytes: true, commits: 1 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      b.run(job, { grant: b.grantFor(job) });
      const stored = b.store.get(job.output_key);
      return {
        job,
        checksum_equals_bytes: job.output_checksum === sha256Bytes(stored),
        commits: b.docs.commits,
        snapshot: b.record(),
      };
    },
  },
  {
    id: "output-length-off-by-one",
    requirement: "a declared output length off by one is invalid before storage and never commits",
    expect: { state: "failed", code: "engine_result_invalid", revision_delta: 0, version_delta: 0, ledger_state: null },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env, { behaviour: "length_off_by_one" });
      b.run(job, { grant: b.grantFor(job) });
      return { job, ledger: b.book.get(job.job_id), snapshot: b.record() };
    },
  },
  {
    id: "timeout-before-settle",
    requirement: "an engine timeout settles the job timed_out and commits nothing",
    expect: { state: "timed_out", code: "engine_timeout", revision_delta: 0, version_delta: 0 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env, { behaviour: "timeout" });
      b.run(job, { grant: b.grantFor(job) });
      return { job, snapshot: b.record() };
    },
  },
  {
    id: "cancel-vs-complete-cancel-first",
    requirement: "when cancel settles first, a late engine result is discarded and nothing commits",
    expect: { state: "cancelled", code: "grant_actor_mismatch", linearized: true, already_committed: false, late_applied: false, revision_delta:
    0, version_delta: 0 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length:
      1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      // A foreign actor cannot cancel a job it does not own; the job stays accepted.
      let error = null;
      try { b.cancel(cancelEnvelope(job.job_id), { actorId: "ACTOR-B" }); } catch (e) { error = e; }
      const cancelled = b.cancel(cancelEnvelope(job.job_id));
      const late = b.applyLateResult(job);
      return { cancelled, late, job, error, snapshot: b.record() };
    },
  },
  {
    id: "cancel-vs-complete-complete-first",
    requirement: "when complete settles first, cancel reports the truth and cannot undo the commit",
    expect: { state: "completed", late_cancel_linearized: false, already_committed: true, commits: 1 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      b.run(job, { grant: b.grantFor(job) });
      const cancelled = b.cancel(cancelEnvelope(job.job_id));
      return { job, cancelled, late_cancel_linearized: cancelled.linearized, already_committed: cancelled.already_committed, commits: b.docs.commits, snapshot: b.record() };
    },
  },
  {
    id: "crash-mid-run",
    requirement: "an engine crash settles crashed, commits nothing and leaves the object orphaned",
    expect: { state: "crashed", code: "engine_crashed", revision_delta: 0, version_delta: 0 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      b.run(job, { grant: b.grantFor(job), cause: "crash" });
      return { job, snapshot: b.record() };
    },
  },
  {
    id: "restart-running-becomes-crashed",
    requirement: "a running job reloaded after a restart is crashed, not silently re-run",
    expect: { before: "running", after: "crashed", version_delta: 0 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      job.state = "running";
      const before = job.state;
      const reloaded = b.recoverJob(job.job_id);
      return { before, after: reloaded.state, reloaded, snapshot: b.record() };
    },
  },
  {
    id: "restart-completed-replays",
    requirement: "a completed job replays under the same idempotency key instead of producing a second version",
    expect: { state: "completed", replay: true, version_delta: 1, commits: 1 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const first = b.submit(env);
      b.run(first.job, { grant: b.grantFor(first.job) });
      const second = b.submit(env);
      return { first, second, job: second.job, replay: second.replay, commits: b.docs.commits, snapshot: b.record() };
    },
  },
  {
    id: "same-key-same-payload-replay",
    requirement: "the same key with the same fingerprint replays and adds no version",
    expect: { first_replay: false, second_replay: true, commits: 1, version_delta: 1 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const first = b.submit(env);
      b.run(first.job, { grant: b.grantFor(first.job) });
      const second = b.submit(env);
      return { first_replay: first.replay, second_replay: second.replay, job: second.job, commits: b.docs.commits, snapshot: b.record() };
    },
  },
  {
    id: "same-key-different-payload",
    requirement: "the same key with a different payload is refused instead of replaying the old response",
    expect: { code: "payload_fingerprint_mismatch", status: 409, version_delta: 0, jobs: 1 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      b.submit(env);
      const other = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:foreign", input_bytes: B64("m"),
      input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });

      let error = null;
      try { b.submit(other); } catch (e) { error = e; }
      return { error, snapshot: b.record() };
    },
  },
  {
    id: "same-key-in-flight",
    requirement: "the same key while the first job is unsettled is in_flight, a retryable conflict",
    expect: { code: "in_flight", status: 409, retryable: true, commits: 0 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      b.submit(env);
      let error = null;
      try { b.submit(env); } catch (e) { error = e; }
      return { error, commits: b.docs.commits, snapshot: b.record() };
    },
  },
  {
    id: "grant-expired",
    requirement: "an expired grant is refused with grant_expired",
    expect: { code: "grant_expired", status: 401, state: "failed", commits: 0, version_delta: 0 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      // Expire the TRUSTED registry copy, not the caller's handle: a caller cannot
      // extend its own grant. run() refuses before any engine or commit work.
      const grant = b.grantFor(job);
      b.grantRegistry.set(grant.grant_id, { ...b.grantRegistry.get(grant.grant_id), expires_at: 0 });
      b.run(job, { grant });
      return { error: job.error, job, commits: b.docs.commits, snapshot: b.record() };

    },
  },
  {
    id: "grant-reused",
    requirement: "a consumed single-use grant cannot authorize a second commit",
    expect: { code: "grant_consumed", status: 409, retryable: false, state: "failed", commits: 1, version_delta: 1 },
    run: (b) => {
      const mk = (key, rev, ver) => baseEnvelope({ operation: "serialize", request_id: "REQ-" + key, idempotency_key: key, payload:
      { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")),
      base_revision: rev, base_version_id: ver } });
      const first = b.submit(mk("IDEMP-R1", 7, "01J8Z0V0000000000000000A")).job;
      b.run(first, { grant: b.grantFor(first) });                 // one commit; the grant is consumed at that point
      const second = b.submit(mk("IDEMP-R2", b.docs.currentRevision(), b.docs.currentVersionId())).job;
      b.run(second, { grant: first.grant });                      // the used grant cannot authorize a second commit
      return { job: second, error: second.error, commits: b.docs.commits, consumed: b.grantRegistry.get(first.grant.grant_id).consumed, snapshot:
      b.record() };
    },
  },  {
    id: "grant-scope-exceeded",
    requirement: "a read grant cannot authorize a serialize (write) operation",
    expect: { code: "grant_scope", status: 403, state: "failed", commits: 0, version_delta: 0 },
    run: (b) => {
      const p = { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum:
      sha256Bytes(Buffer.from("m")),
      base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" };
      const firstJob = b.submit(baseEnvelope({ operation: "serialize", payload: p })).job;
      // A read grant used for serialize is refused by run on the PUBLIC scope path:
      // the trusted grant's scope is not write_branch. This case measures THAT
      // refusal; the unrelated registry/handle binding-drift subcase is gone.
      b.run(firstJob, { grant: b.readGrantFor(firstJob) });
      return { job: firstJob, error: firstJob.error, commits: b.docs.commits, snapshot: b.record() };
    },
  },
  {
    id: "grant-actor-mismatch",
    requirement: "a grant issued to one actor cannot be used by another",
    expect: { code: "grant_actor_mismatch", status: 403, state: "accepted", commits: 0, version_delta: 0 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length:
      1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      const grant = b.grantFor(job);
      let error = null;
      try { b.run(job, { actorId: "ACTOR-B", grant }); } catch (e) { error = e; }
      return { error, job, commits: b.docs.commits, snapshot: b.record() };
    },
  },
  {
    id: "object-written-before-db-commit",
    requirement: "byte for a version exists in the object store before any DB version row does",
    expect: { object_exists: true, version_row_exists_at_put_time: false, state: "completed", commits: 1 },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      const observed = { object_exists: false, version_row_exists_at_put_time: false };
      const originalPut = b.store.put.bind(b.store);
      b.store.put = (key, bytes) => { observed.object_exists = true; observed.version_row_exists_at_put_time = b.docs.versions.length > 0; return originalPut(key, bytes); };
      b.run(job, { grant: b.grantFor(job) });
      b.store.put = originalPut;
      return { job, observed, state: job.state, commits: b.docs.commits, snapshot: b.record() };
    },
  },
  {
    id: "db-rollback-leaves-orphan",
    requirement: "a DB commit failure leaves the current version untouched and the object orphaned, not referenced",
    expect: { state: "failed", revision_delta: 0, version_delta: 0, ledger_state: "orphaned", object_still_present: true },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      b.docs.failCommit = true;
      b.run(job, { grant: b.grantFor(job), cause: "db_fail" });
      b.docs.failCommit = false;
      return { job, ledger: b.book.get(job.job_id), object_still_present: b.store.has(job.output_key ?? ""), snapshot: b.record() };
    },
  },
  {
    id: "cleanup-delete-error-surfaced",
    requirement: "a failing DeleteObject is surfaced and retried, never counted as deleted and never dropped",
    expect: { deleted: 0, failed: 1, ledger_state: "orphaned", attempts: 1, last_error: "object_missing" },
    run: () => {
      const store = createFakeObjectStore({ deleteFails: true });
      const book = createLedger({ objectStore: store });
      book.record({ job_id: "JOB-ORPHAN-1", object_key: "office/jobs/JOB-ORPHAN-1/out", object_state: "orphaned" });
      const report = book.reconcileOrphans();
      return { report, ledger: book.get("JOB-ORPHAN-1") };
    },
  },
  {
    id: "cleanup-never-deletes-committed",
    requirement: "the reconciler deletes only orphaned objects and never a committed version's bytes",
    expect: { deleted: 1, committed_deleted: false, committed_object_present: true },
    run: () => {
      const store = createFakeObjectStore();
      const book = createLedger({ objectStore: store });
      store.put("office/versions/V1.docx", Buffer.from("committed-bytes"));
      book.record({ job_id: "JOB-COMMITTED", object_key: "office/versions/V1.docx", object_state: "committed" });
      book.record({ job_id: "JOB-ORPHAN-2", object_key: "office/jobs/JOB-ORPHAN-2/out", object_state: "orphaned" });
      store.put("office/jobs/JOB-ORPHAN-2/out", Buffer.from("orphan-bytes"));
      const report = book.reconcileOrphans();
      return { report, committed_deleted: store.deleted.includes("office/versions/V1.docx"), committed_object_present: store.has("office/versions/V1.docx") };
    },
  },
  {
    id: "engine-down-original-still-available",
    requirement: "with the engine down, listing, metadata and original download still work; only engine-dependent operations fail",
    expect: { list_ok: true, original_ok: true, engine_op_code: "engine_crashed", revision_delta: 0, version_delta: 0, commits: 0 },
    run: (b) => {
      b.setEngineAvailable(false);
      // capability is a catalogue read: it completes with no engine and no version.
      const cap = b.submit(baseEnvelope({ operation: "capability", request_id: "REQ0000000000000000000006", idempotency_key: "IDEMP-CAP-1",
      payload: { max_input_bytes: LIMITS.max_input_bytes } })).job;
      b.run(cap);
      // open parses to a model and must NEVER create a version, engine up or down.
      const open = b.submit(baseEnvelope({ operation: "open", request_id: "REQ0000000000000000000007", idempotency_key: "IDEMP-OPEN-1" })).job;
      b.run(open, { grant: b.grantFor(open) });
      // The document list and the original bytes do not go through the engine.
      const list = b.listDocuments();
      const original = b.readOriginal("DOC-1");
      b.setEngineAvailable(true);
      return { list_ok: Array.isArray(list), original_ok: original !== null, engine_op_code: open.error ? open.error.code : null, job: open,
      cap_state: cap.state, commits: b.docs.commits, snapshot: b.record() };
    },
  },
  {
    id: "no-path-in-browser-result",
    requirement: "no browser-visible result exposes a filesystem path, a private storage key or a service credential",
    expect: { clean: true, leaked: [], commits: 1, state: "failed", code: "not_found" },
    run: (b) => {
      // An open job establishes trusted scoped model state, and commits nothing.
      const opened = b.submit(baseEnvelope({ operation: "open", request_id: "REQ0000000000000000000008", idempotency_key: "IDEMP-NP-1" })).job;
      b.run(opened, { grant: b.grantFor(opened) });
      // serialize may carry ONLY the model reference: no bytes on the wire is legitimate.
      const serializeEnv = baseEnvelope({ operation: "serialize", request_id: "REQ0000000000000000000009", idempotency_key: "IDEMP-NP-2", payload:
      { document_model_ref: opened.document_model_ref, base_revision: b.docs.currentRevision(), base_version_id: b.docs.currentVersionId() } });
      const { job } = b.submit(serializeEnv);
      b.run(job, { grant: b.grantFor(job) });
      const browserFacing = b.browserProjection(job);
      const leaked = scanForLeaks(browserFacing);
      // An UNRESOLVED model reference is refused by name; caller text is never bytes.
      const foreign = b.submit(baseEnvelope({ operation: "serialize", request_id: "REQ0000000000000000000010", idempotency_key: "IDEMP-NP-3",
      payload: { document_model_ref: "engine-session:foreign", base_revision: b.docs.currentRevision(), base_version_id:
      b.docs.currentVersionId() } })).job;
      b.run(foreign, { grant: b.grantFor(foreign) });
      return { browserFacing, leaked, clean: leaked.length === 0, job: foreign, error: foreign.error, commits: b.docs.commits, snapshot:
      b.record() };
    },
  },
  {
    id: "terminal-state-immutable",
    requirement: "a settled job cannot move to another state",
    expect: { code: "invalid_transition", first: "completed", second: "completed" },
    run: (b) => {
      const env = baseEnvelope({ operation: "serialize", payload: { document_model_ref: "engine-session:1", input_bytes: B64("m"), input_length: 1, input_checksum: sha256Bytes(Buffer.from("m")), base_revision: 7, base_version_id: "01J8Z0V0000000000000000A" } });
      const { job } = b.submit(env);
      b.run(job, { grant: b.grantFor(job) });
      const first = b.settle(job, "completed");
      let error = null;
      try { b.settle(job, "failed"); } catch (e) { error = e; }
      const second = b.settle(job, "completed");
      return { error, first, second, job };
    },
  },
  {
    id: "convert-export-unsupported-at-g0",
    requirement: "convert and export refuse by NAME with unsupported_operation (501) before any grant check, committing nothing - the G0 runtime choice",
    expect: { state: "failed", code: "unsupported_operation", status: 501, retryable: false, first: "failed", second: "failed", commits: 0, jobs: 2 },
    run: (b) => {
      // Both operations share ONE named-refusal branch that runs BEFORE authorizeGrant,
      // so a grantless run settles failed instead of demanding a grant.
      const conv = b.submit(baseEnvelope({ operation: "convert", request_id: "REQ0000000000000000000021", idempotency_key: "IDEMP-CONV-1", payload: { source_version_id: "01J8Z0V0000000000000000A", target_format: "pdf", overwrite_source: false, options: {} } })).job;
      b.run(conv);
      const exp = b.submit(baseEnvelope({ operation: "export", request_id: "REQ0000000000000000000022", idempotency_key: "IDEMP-EXP-1", payload: { source_version_id: "01J8Z0V0000000000000000A", target_format: "docx", overwrite_source: false, options: {} } })).job;
      b.run(exp);
      return { job: exp, first: conv.state, second: exp.state, commits: b.docs.commits, snapshot: b.record() };
    },
  },
];

/** Camel/snake/path/credential patterns a browser-facing result must never match. */
const LEAK_PATTERNS = [
  { rule: "posix_absolute_path", re: /(^|[\s"'=(:])\/(?:home|Users|var|tmp|etc|opt|mnt)\// },
  { rule: "windows_absolute_path", re: /[A-Za-z]:\\+/ },
  { rule: "file_url", re: /file:\/\// },
  { rule: "unc_path", re: /\\\\[A-Za-z0-9._-]+\\/ },
  { rule: "storage_key_field", re: /(?:"|')?(?:object_key|input_object_key|storage_key|bucket|minio_key)(?:"|')?\s*:/ },
  { rule: "credential_field", re: /(?:"|')?(?:token|secret|password|credential|authorization|api_key|signed_url|presigned)(?:"|')?\s*:/i },
  { rule: "engine_endpoint", re: /https?:\/\/\S*engine/i },
];

/** Scan a browser-facing projection for anything that must never leave Go. */
export function scanForLeaks(value) {
  const text = JSON.stringify(value ?? null);
  const leaked = [];
  for (const { rule, re } of LEAK_PATTERNS) {
    if (re.test(text)) leaked.push(rule);
  }
  return leaked;
}

/** Reduce a case result to the comparable, literal oracle fields. */
function observe(caseResult) {
  const job = caseResult.job ?? null;
  const snapshot = caseResult.snapshot ?? null;
  return {
    state: job ? job.state : caseResult.state ?? null,
    code: caseResult.error ? caseResult.error.code ?? "contract_violation" : job && job.error ? job.error.code : null,
    kind: caseResult.error && caseResult.error.name === "ContractViolation" ? "contract_violation" : null,
    field_path: caseResult.error && caseResult.error.name === "ContractViolation" ? caseResult.error.field_path : null,
    status: caseResult.error ? caseResult.error.status ?? null : job && job.error ? job.error.status : null,
    error_class: caseResult.error ? caseResult.error.error_class ?? null : job && job.error ? job.error.error_class : null,
    retryable: caseResult.error ? caseResult.error.retryable ?? null : job && job.error && typeof job.error.retryable === "boolean" ? job.error.retryable : null,
    revision_delta: caseResult.revision_delta ?? null,
    version_delta: caseResult.version_delta ?? null,
    jobs: snapshot ? snapshot.job_count : null,
    objects: snapshot ? snapshot.objects.length : null,
    commits: caseResult.commits ?? null,
    ledger_state: caseResult.ledger ? caseResult.ledger.object_state : null,
    attempts: caseResult.ledger ? caseResult.ledger.attempts : null,
    last_error: caseResult.ledger ? caseResult.ledger.last_error : null,
    checksum_equals_bytes: caseResult.checksum_equals_bytes ?? null,
    linearized: caseResult.cancelled ? caseResult.cancelled.linearized : caseResult.linearized ?? null,
    already_committed: caseResult.cancelled ? caseResult.cancelled.already_committed : caseResult.already_committed ?? null,
    late_applied: caseResult.late ? caseResult.late.applied : null,
    first_replay: caseResult.first_replay ?? null,
    second_replay: caseResult.second_replay ?? null,
    replay: caseResult.replay ?? null,
    deleted: caseResult.report ? caseResult.report.deleted : null,
    failed: caseResult.report ? caseResult.report.failed : null,
    committed_deleted: caseResult.committed_deleted ?? null,
    committed_object_present: caseResult.committed_object_present ?? null,
    object_exists: caseResult.observed ? caseResult.observed.object_exists : null,
    version_row_exists_at_put_time: caseResult.observed ? caseResult.observed.version_row_exists_at_put_time : null,
    object_still_present: caseResult.object_still_present ?? null,
    list_ok: caseResult.list_ok ?? null,
    original_ok: caseResult.original_ok ?? null,
    engine_op_code: caseResult.engine_op_code ?? null,
    clean: caseResult.clean ?? null,
    leaked: caseResult.leaked ?? null,
    before: caseResult.before ?? null,
    after: caseResult.after ?? null,
    first: caseResult.first ?? null,
    second: caseResult.second ?? null,
    late_cancel_linearized: caseResult.late_cancel_linearized ?? null,
  };
}

/**
 * Evidence registry. It exists so a reader cannot mistake model coverage for
 * engine coverage. Every mandatory case in THIS file stays labelled
 * reference_test: the injection seam below is still a fake, and running these
 * model cases proves nothing about any engine.
 *
 * The task-4.4 run lives in its own file,
 * `scripts/office-g0/engine-contract-adapter.mjs`, which drives the real DOC-003
 * spike engine host (UNI-667) over its loopback transport and records what the
 * transport actually answered. Its cases are labelled real_engine_evidence and
 * each one names the adapter code it observed. This entry POINTS at that run; it
 * does not silently promote the model cases above, and a reader must still check
 * that the adapter run happened on the pinned host.
 */
export const EVIDENCE_REGISTRY = {
  reference_test: {
    runner: "scripts/office-g0/engine-contract.mjs",
    what_it_proves: "the boundary model is internally consistent with the contract doc",
    what_it_does_not_prove: "that any GenOffice engine, the Go service, an object store or a browser behaves this way",
    cases: "all ids in FAULT_CASES",
  },
  real_engine_evidence: {
    status: "present",
    runner: "scripts/office-g0/engine-contract-adapter.mjs",
    transport: "loopback-http-post",
    engine: "DOC-003 spike engine host (UNI-667) e2e/office-g0/engine-host.mts",
    upstream_pin: "09485f884dc845cf3bf27fb7edfe489f9d457aad",
    // A STABLE digest over the adapter CASE ORACLES, not over the evidence file. The
    // file cannot be pinned: buildAdapterEvidence embeds generated_at and an absolute
    // lab path, so its own bytes change on every run even when the 11 oracles hold.
    case_oracle_digest: "bae36e364475441967d8bf092e1c34b43d11a14c5239745be6bc08b8de0f5cad",
    what_it_proves:
      "the real DOC-003 engine host refuses the faulty calls this contract names and completes a real docx edit and PDF text read, over its loopback transport",
    what_it_does_not_prove:
      "browser rendering, the Go service, product auth/ACL/tenant isolation, object storage, packaging, or the six-browser DOC-003 flows (UNI-667 owns those)",
    note:
      "This registry entry is a POINTER, not a pass. `case_oracle_digest` pins the 11 case oracles a real run must match; reproduce them by running the adapter against a booted host. The model cases in THIS file stay reference_test, and 'present' does NOT promote them.",
  },
};

/** Run one case against a fresh boundary and return its observed + expected. */
export function runCase(testCase) {
  const boundary = createBoundary({ now: () => 0 });
  const before = boundary.record();
  let result;
  let thrown = null;
  try {
    result = testCase.run(boundary);
  } catch (error) {
    thrown = error;
  }
  const after = boundary.record();
  const observed = observe({ ...(result ?? {}), snapshot: thrown ? before : (result && result.snapshot) || after });
  observed.revision_delta = after.current_revision - before.current_revision;
  observed.version_delta = after.versions - before.versions;
  if (thrown) {
    observed.unexpected_throw = { name: thrown.name, message: thrown.message };
  }
  const comparable = {};
  for (const key of Object.keys(testCase.expect)) {
    comparable[key] = observed[key];
  }
  const mismatches = Object.keys(testCase.expect).filter((key) => {
    return JSON.stringify(comparable[key]) !== JSON.stringify(testCase.expect[key]);
  });
  return {
    id: testCase.id,
    requirement: testCase.requirement,
    expect: testCase.expect,
    observed: comparable,
    mismatches,
    pass: mismatches.length === 0 && !thrown,
    evidence_kind: "reference_test",
  };
}

/** Run every mandatory case. Returns a report; a failing case fails the run. */
export function runAllCases() {
  const results = FAULT_CASES.map((c) => runCase(c));
  const passed = results.filter((r) => r.pass).length;
  return {
    contract_version: CONTRACT_VERSION,
    protocol_version: PROTOCOL_VERSION,
    wire_format: WIRE_FORMAT,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
    evidence_kind: "reference_test",
    registry: EVIDENCE_REGISTRY,
  };
}

/** The case ids the contract doc's table requires. The test suite asserts the
 * FAULT_CASES list covers exactly this set, so a case cannot be quietly dropped. */
export const REQUIRED_CASE_IDS = [
  "malformed-missing-format",
  "malformed-unknown-operation",
  "malformed-float-length",
  "malformed-negative-deadline",
  "malformed-oversize-input",
  "malformed-bad-checksum-hex",
  "contract-version-mismatch",
  "protocol-version-mismatch",
  "engine-version-incompatible-is-typed",
  "input-checksum-mismatch",
  "output-checksum-recomputed",
  "output-length-off-by-one",
  "timeout-before-settle",
  "cancel-vs-complete-cancel-first",
  "cancel-vs-complete-complete-first",
  "crash-mid-run",
  "restart-running-becomes-crashed",
  "restart-completed-replays",
  "same-key-same-payload-replay",
  "same-key-different-payload",
  "same-key-in-flight",
  "grant-expired",
  "grant-reused",
  "grant-scope-exceeded",
  "grant-actor-mismatch",
  "object-written-before-db-commit",
  "db-rollback-leaves-orphan",
  "cleanup-delete-error-surfaced",
  "cleanup-never-deletes-committed",
  "engine-down-original-still-available",
  "no-path-in-browser-result",
  "terminal-state-immutable",
  "convert-export-unsupported-at-g0",
];

/** Build the durable evidence object written by --out. */
export function buildEvidence(report) {
  return {
    issue: "UNI-668",
    parent_issue: "UNI-656",
    task: "DOC-004 engine/editor/storage contract - reference boundary harness",
    contract_version: CONTRACT_VERSION,
    protocol_version: PROTOCOL_VERSION,
    wire_format: WIRE_FORMAT,
    contract_doc: CONTRACT_DOC,
    runtime_map_doc: RUNTIME_MAP_DOC,
    evidence_kind: "reference_test",
    generated_at: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    registry: EVIDENCE_REGISTRY,
    limitation:
      "Reference model only. No HTTP server, no Go service, no product auth or tenancy, no real engine, no object store, no browser. Do not cite as engine or browser evidence; task 4.4 and DOC-003 (UNI-667) own that.",
    cases: report.results.map((r) => ({ id: r.id, pass: r.pass, mismatches: r.mismatches, expect: r.expect, observed: r.observed })),
  };
}

function main(argv) {
  const print = argv.includes("--print");
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex === -1 ? null : argv[outIndex + 1];
  const report = runAllCases();

  if (print) {
    for (const r of report.results) {
      const status = r.pass ? "PASS" : "FAIL";
      process.stdout.write(status + "  " + r.id + (r.pass ? "" : "  mismatches=" + JSON.stringify(r.mismatches)) + "\n");
    }
  }
  process.stdout.write("engine-contract: " + report.passed + "/" + report.total + " cases match their oracle (reference_test)\n");

  if (outPath) {
    const evidence = buildEvidence(report);
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outPath), JSON.stringify(evidence, null, 2) + "\n", "utf8");
    process.stdout.write("evidence written to " + outPath + "\n");
  }

  return report.failed === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
