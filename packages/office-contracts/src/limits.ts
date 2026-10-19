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
// The input ceiling is lower (size-cap:005): the submit body is one JSON
// envelope carrying the input in base64, and the supervisor turns it into a
// V8 string whose maximum length is 0x1fffffe8 = 536870888 chars;
// 4*ceil(N/3) + 64 KiB envelope slack <= 536870888 gives N <= 402604014, and
// 383 MiB = 401604608 is the round ceiling below it. A JSON wire format can
// never transport a larger input, so the contract refuses it up front.
export const ENGINE_LIMITS = {
  max_input_bytes: 401604608,
  max_output_bytes: 2 * 1024 * 1024 * 1024,
  max_edit_ops: 20000,
  max_deadline_ms: 600000,
  min_deadline_ms: 1,
  max_warnings: 512,
  max_identifier_length: 128,
} as const;

export const engineLimitsSchema = z.object({
  max_input_bytes: z.number().int().positive(),
  max_edit_ops: z.number().int().positive().optional(),
});
export type EngineLimits = z.infer<typeof engineLimitsSchema>;
