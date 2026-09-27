import { z } from "zod";

// Finite, safe bounds the boundary enforces before a job exists. Mirror of
// LIMITS in scripts/office-g0/engine-contract.mjs — changing a bound is a
// contract change and needs the Go mirror in server/internal/office updated in
// the same commit.
export const ENGINE_LIMITS = {
  max_input_bytes: 64 * 1024 * 1024,
  max_output_bytes: 128 * 1024 * 1024,
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
