import { z } from "zod";
import { officeFormatSchema } from "./formats.ts";
import { engineOperationSchema } from "./operations.ts";
import { jobStateSchema } from "./job-states.ts";
import { engineErrorCodeSchema } from "./error-codes.ts";
import { evidenceLevelSchema, runtimeKindSchema } from "./capabilities.ts";
import { fidelityWarningSchema } from "./warnings.ts";
import { ENGINE_LIMITS } from "./limits.ts";
import { scanForLeaks } from "./leaks.ts";
import { EngineContractViolation } from "./errors.ts";

// Wire result shapes (engine-contract.md §4). Every result is snake_case; the
// internal job ledger row MAY carry authority fields, but what a browser or
// public caller receives is the projection built by toPublicJobResult, which
// strips them and refuses to emit a leaky payload.

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const warningList = z.array(fidelityWarningSchema).max(ENGINE_LIMITS.max_warnings);

/** The error body inside an error envelope (§4.7). Extra fields are allowed
 * because BoundaryError.toJSON merges caller fields - but they are scanned for
 * leaks before any public emission. */
export const engineErrorBodySchema = z
  .object({
    code: engineErrorCodeSchema,
    status: z.number().int(),
    error_class: z.string(),
    kind: z.string(),
    retryable: z.boolean(),
    fidelity_preserved: z.literal(true),
  })
  .loose();
export type EngineErrorEnvelopeBody = z.infer<typeof engineErrorBodySchema>;

export const errorEnvelopeSchema = z.object({
  request_id: z.string().min(1).optional(),
  state: z.literal("failed"),
  operation: engineOperationSchema.optional(),
  error: engineErrorBodySchema,
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

const resultBase = {
  request_id: z.string().min(1).optional(),
  job_id: z.string().min(1),
  state: jobStateSchema,
  operation: engineOperationSchema,
  engine_version: z.string().optional(),
};

/** open completes with a grant-scoped model reference - never a path, a
 * file:// URL or a desktop handle. */
export const openResultSchema = z.object({
  ...resultBase,
  operation: z.literal("open"),
  document_model_ref: z.string().min(1),
  document_model_kind: z.string().optional(),
  input_checksum: hex64.optional(),
  input_length: z.number().int().min(0).optional(),
  warnings: warningList,
});
export type OpenResult = z.infer<typeof openResultSchema>;

/** edit completes with the updated session model reference. */
export const editResultSchema = z.object({
  ...resultBase,
  operation: z.literal("edit"),
  document_model_ref: z.string().min(1),
  warnings: warningList,
});
export type EditResult = z.infer<typeof editResultSchema>;

/** The INTERNAL serialize result: the engine side may name the object it
 * wrote. This shape must never reach a browser - toPublicJobResult strips
 * output_object_key (and output_bytes is only ever on the service wire). */
export const serializeResultSchema = z.object({
  ...resultBase,
  operation: z.literal("serialize"),
  output_object_key: z.string().optional(),
  output_checksum: hex64,
  output_length: z.number().int().min(0),
  version_id: z.string().optional(),
  base_revision: z.number().int().min(0).optional(),
  base_version_id: z.string().optional(),
  warnings: warningList,
});
export type SerializeResult = z.infer<typeof serializeResultSchema>;

export const convertFidelitySchema = z.object({
  level: z.enum(["exact", "limited", "unsupported"]),
  // When level is "limited" the engine must name what it did not preserve.
  lost: z.array(z.string()).optional(),
  warnings: warningList.optional(),
});
export type ConvertFidelity = z.infer<typeof convertFidelitySchema>;

/** Future (G2) wire shape for convert/export. At G0 these operations settle
 * failed with error.code = "unsupported_operation" instead of a result. */
export const convertResultSchema = z.object({
  ...resultBase,
  operation: z.enum(["convert", "export"]),
  output_object_key: z.string().optional(),
  output_checksum: hex64,
  output_length: z.number().int().min(0),
  fidelity: convertFidelitySchema,
  source_version_id: z.string().min(1),
});
export type ConvertResult = z.infer<typeof convertResultSchema>;

/** capability is a catalogue read: no grant, no engine, no object. */
export const capabilityResultSchema = z.object({
  ...resultBase,
  operation: z.literal("capability"),
  format: officeFormatSchema,
  capabilities: z.array(
    z.object({
      operation: z.string(),
      supported: z.boolean(),
      runtime: runtimeKindSchema,
      evidence_level: evidenceLevelSchema,
      reason: z.string().optional(),
    }),
  ),
  limits: z.object({
    max_input_bytes: z.number().int().positive(),
    max_edit_ops: z.number().int().positive().optional(),
  }),
});
export type CapabilityResult = z.infer<typeof capabilityResultSchema>;

/** Cancel is best-effort but its result is deterministic: a job that already
 * committed answers state "completed" with the committed version, never a
 * pretend cancel. */
export const cancelResultSchema = z.object({
  job_id: z.string().min(1),
  previous_state: jobStateSchema,
  state: jobStateSchema,
  linearized_at: z.number().int().optional(),
  version_id: z.string().optional(),
});
export type CancelResult = z.infer<typeof cancelResultSchema>;

// ---------------------------------------------------------------------------
// Public projection
// ---------------------------------------------------------------------------

/** Keys that must never appear in a browser-facing result. Mirrors the
 * authority rule: clients see ids and bytes/JSON, never paths or storage
 * names. */
const PUBLIC_STRIP_KEYS = new Set([
  "output_object_key",
  "output_key",
  "object_key",
  "storage_key",
  "input_object_key",
  "source_object_key",
  "actor_id",
  "organization_id",
  "workspace_id",
  "grant_id",
]);

function stripAuthority(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAuthority);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!PUBLIC_STRIP_KEYS.has(k)) out[k] = stripAuthority(v);
    }
    return out;
  }
  return value;
}

/**
 * Project an internal job result into what a browser/public caller may see:
 * authority and storage-naming fields stripped, then scanned for leaks. A
 * result that would leak is a contract bug on OUR side, so it raises
 * EngineContractViolation rather than emitting the leaky payload.
 */
export function toPublicJobResult(result: Record<string, unknown>): Record<string, unknown> {
  const projected = stripAuthority(result);
  const leaked = scanForLeaks(projected);
  if (leaked.length > 0) {
    throw new EngineContractViolation(
      "result",
      "public_projection_leak",
      leaked.join(","),
    );
  }
  return projected as Record<string, unknown>;
}
