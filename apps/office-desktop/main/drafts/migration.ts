import { z } from "zod";

const envelopeSchema = z.object({ version: z.number().int().min(1).max(2), draftId: z.string().min(1), keyNamespace: z.string().min(1), ciphertext: z.string().min(1), checksum: z.string().min(1) }).strict();
export type DraftEnvelope = z.infer<typeof envelopeSchema>;

/** Support matrix: v1 is the G4-04 format; v2 adds metadata only. Both read
 * through the same key namespace and ciphertext, so rollback never deletes or
 * re-encrypts a user's draft. */
export const DRAFT_FORMAT_SUPPORT_MATRIX = Object.freeze([
  { from: 1, to: 1, action: "read/write" },
  { from: 1, to: 2, action: "migrate metadata, preserve ciphertext" },
  { from: 2, to: 1, action: "read legacy fields, preserve ciphertext" },
]);

export function readDraftEnvelope(raw: unknown): DraftEnvelope { return envelopeSchema.parse(raw); }

export function migrateDraftEnvelope(raw: unknown, targetVersion: 1 | 2): DraftEnvelope {
  const envelope = readDraftEnvelope(raw);
  if (envelope.version === targetVersion) return envelope;
  return { ...envelope, version: targetVersion };
}
