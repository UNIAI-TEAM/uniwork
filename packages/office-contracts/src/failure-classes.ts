import { z } from "zod";
import { officeFormatSchema } from "./formats.ts";
import { engineErrorCodeSchema } from "./error-codes.ts";

// P3 (docs/office/g1g2/port-items.md): a failed open of a Workspace file must
// not land on a blank document. Upstream loadFile swaps the failed document
// for newFile and overwrites the status line; in UniWork the adapter returns
// this typed report instead, bound to the file id, so the client can keep a
// named error visible and must never offer Save of a blank over the original.

export const openFailureClasses = [
  // Encrypted input: no password attempted yet, the host should prompt.
  "password_required",
  // The user dismissed the password prompt (upstream cancelDocPwd path).
  "password_cancelled",
  // Decrypt refused the supplied password.
  "wrong_password",
  // The bytes are not a parseable package for the declared format.
  "corrupted",
  // A named engine boundary error ended the open (carried in engine_error).
  "engine_error",
  // The engine knows the format but not this construct (ported unsupported).
  "unsupported_feature",
  // Bytes are not the declared format at all (e.g. not a ZIP/OOXML container).
  "not_office_file",
  // The host read/write port failed before the engine saw bytes.
  "io_error",
  // Input exceeded the boundary byte bound (maps to upload_bounds).
  "too_large",
] as const;
export const openFailureClassSchema = z.enum(openFailureClasses);
export type OpenFailureClass = (typeof openFailureClasses)[number];

/** The typed failure report an adapter returns instead of a blank document.
 * `document_id` is the Workspace file id the failure is bound to - the client
 * keys its error state on it and never writes it back over the source. */
export const openFailureReportSchema = z.object({
  document_id: z.string().min(1),
  format: officeFormatSchema,
  failure_class: openFailureClassSchema,
  // Localized, user-presentable text from the adapter. Never a path, key or
  // token - the projection scans it (scanForLeaks).
  message: z.string().optional(),
  // Present when failure_class === "engine_error": the boundary error code the
  // engine returned, so the client can still branch on retryable.
  engine_error: engineErrorCodeSchema.nullish(),
});
export type OpenFailureReport = z.infer<typeof openFailureReportSchema>;

/** Discriminated open result for host adapters: either a document model plus
 * the engine's open result fields, or a named failure - never a third option
 * such as "succeeded with a blank substitute". */
export const openOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("opened"),
    document_id: z.string().min(1),
    document_model_ref: z.string().min(1),
    warnings: z.array(z.unknown()).default([]),
  }),
  openFailureReportSchema.extend({ outcome: z.literal("failed") }),
]);
export type OpenOutcome = z.infer<typeof openOutcomeSchema>;
