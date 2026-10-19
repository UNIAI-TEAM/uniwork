import { z } from "zod";

// Finite, safe bounds the boundary enforces before a job exists. Mirror of
// LIMITS in scripts/office-g0/engine-contract.mjs — changing a bound is a
// contract change and needs the Go mirror in server/internal/office updated in
// the same commit.
//
// The output ceiling is the document cap's configured maximum (SIZE-S1,
// UNI-1859): the server bounds DOCUMENT_MAX_BYTES to [1 MiB, 2 GiB], so a job
// output up to 2 GiB is contract-legal and the running service's own
// configured limit — plus the grant's output.max_bytes — does the real
// gating.
// The input ceiling is the same 2 GiB (SIZE-OPS1): since protocol 2 the
// input travels as raw bytes after the JSON envelope (see the frame below),
// so no V8 string bound applies to it any more.
export const ENGINE_LIMITS = {
  max_input_bytes: 2 * 1024 * 1024 * 1024,
  max_output_bytes: 2 * 1024 * 1024 * 1024,
  max_edit_ops: 20000,
  max_deadline_ms: 600000,
  min_deadline_ms: 1,
  max_warnings: 512,
  max_identifier_length: 128,
} as const;

/** Protocol-2 job frame (SIZE-OPS1): POST /v1/jobs with this content type
 * carries ENVELOPE_LENGTH_HEADER bytes of UTF-8 JSON envelope, immediately
 * followed by exactly input_length raw input bytes; Content-Length covers both.
 * A job without input may still send application/json. */
export const OFFICE_JOB_CONTENT_TYPE = "application/vnd.uniwork.office-job";
export const ENVELOPE_LENGTH_HEADER = "x-office-envelope-length";
/** Upper bound of the JSON envelope prefix: edits[] at max_edit_ops fit with room. */
export const ENVELOPE_MAX_BYTES = 8 * 1024 * 1024;

export const engineLimitsSchema = z.object({
  max_input_bytes: z.number().int().positive(),
  max_edit_ops: z.number().int().positive().optional(),
});
export type EngineLimits = z.infer<typeof engineLimitsSchema>;
