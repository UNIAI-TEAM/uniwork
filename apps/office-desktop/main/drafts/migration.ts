import { z } from "zod";

const identitySchema = z.object({
  deploymentId: z.string().min(1), accountId: z.string().min(1),
  organizationId: z.string().min(1), workspaceId: z.string().min(1), documentId: z.string().min(1),
  base: z.object({ revision: z.string(), version: z.string() }).strict(),
}).strict();
const envelopeSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  encrypted: z.boolean(), draftId: z.string().min(1), identity: identitySchema,
  generation: z.number().int().positive(), checksum: z.string().min(1),
  byteLength: z.number().int().nonnegative(), updatedAt: z.number().finite(),
  nonce: z.string().optional(), ciphertext: z.string(),
  format: z.literal("uniwork-office-draft/2").optional(),
}).strict().superRefine((row, context) => {
  const bytes = Buffer.from(row.ciphertext, "base64");
  if (bytes.toString("base64") !== row.ciphertext || bytes.length !== row.byteLength) context.addIssue({ code: "custom", message: "invalid ciphertext encoding or length" });
  if (row.encrypted && (!row.nonce || Buffer.from(row.nonce, "base64").length !== 12 || bytes.length < 16)) context.addIssue({ code: "custom", message: "invalid authenticated envelope" });
  if (row.version === 2 && row.format !== "uniwork-office-draft/2") context.addIssue({ code: "custom", message: "missing v2 format tag" });
  if (row.version === 1 && row.format !== undefined) context.addIssue({ code: "custom", message: "unexpected v2 format tag" });
});
export type DraftEnvelope = z.infer<typeof envelopeSchema>;

/** This is the actual G4-04 DurableRow. Both readers preserve the existing
 * identity, AAD, path and OS key namespace; v2 adds a format marker only. */
export function readDraftEnvelope(raw: unknown): DraftEnvelope { return envelopeSchema.parse(raw); }

export function migrateDraftEnvelope(raw: unknown, targetVersion: 1 | 2): DraftEnvelope {
  const row = readDraftEnvelope(raw);
  if (targetVersion === 2) return { ...row, version: 2, format: "uniwork-office-draft/2" };
  const { format: _format, ...legacy } = row;
  return { ...legacy, version: 1 };
}
