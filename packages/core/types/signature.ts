import { z } from "zod";

/**
 * One saved signature of the caller (UNI-925 B6). `image` is the raw image
 * base64-encoded without a `data:` prefix; the server stores it per user per
 * organization and caps it at 512 KiB decoded. Schemas are lenient — a row
 * that drifts degrades to empty strings instead of throwing at the boundary.
 */
export const SavedSignatureSchema = z.object({
  id: z.string(),
  label: z.string().optional().default(""),
  content_type: z.string().optional().default("image/png"),
  image: z.string().optional().default(""),
  byte_size: z.number().optional().default(0),
  created_at: z.string().optional().default(""),
});
export type SavedSignature = z.infer<typeof SavedSignatureSchema>;

export const SavedSignatureEnvelopeSchema = z.object({ signature: SavedSignatureSchema });
export const SavedSignatureListEnvelopeSchema = z.object({
  signatures: z.array(SavedSignatureSchema),
});
