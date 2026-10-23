import { z } from "zod";

// Fidelity warnings the engine may raise (engine-contract.md §4.6 /
// FIDELITY_WARNING_CODES). A warning never blocks a commit; the list is closed
// on the wire so the client can render every code it can receive.
export const fidelityWarningCodes = [
  "fonts_substituted",
  "unsupported_construct_preserved",
  "layout_approximate",
  "formula_not_recalculated",
  "external_reference_dropped",
  "macro_preserved_not_executed",
  "signature_invalidated",
  "ocr_not_applied",
] as const;
export const fidelityWarningCodeSchema = z.enum(fidelityWarningCodes);
export type FidelityWarningCode = (typeof fidelityWarningCodes)[number];

export const fidelityWarningSchema = z.object({
  code: fidelityWarningCodeSchema,
  detail: z.string().optional(),
});
export type FidelityWarning = z.infer<typeof fidelityWarningSchema>;
