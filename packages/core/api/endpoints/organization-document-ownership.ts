import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

/**
 * Documents a member owns, as the deactivation dialog needs them (DOC-06,
 * spec §2.2 / §4.2). Counts only, never titles: the organization admin who
 * asks is not reading content.
 */

const WorkspaceCountSchema = z.object({
  workspace_id: z.string(),
  workspace_name: z.string().default(""),
  count: z.number(),
});

const OwnershipSchema = z.object({
  user_id: z.string().default(""),
  total: z.number(),
  workspaces: z.array(WorkspaceCountSchema).default([]),
});

export type MemberDocumentOwnership = z.infer<typeof OwnershipSchema>;

const SkippedSchema = z
  .object({
    recipient_not_member: z.number().catch(0),
    self_restricted: z.number().catch(0),
  })
  .catch({ recipient_not_member: 0, self_restricted: 0 });

const TransferSchema = z.object({
  bulk_id: z.string().default(""),
  transferred: z.number(),
  skipped: SkippedSchema,
  has_more: z.boolean(),
  cursor: z.string().default(""),
});

export type MemberDocumentsTransfer = z.infer<typeof TransferSchema>;

export interface MemberDocumentsTransferInput {
  to_user_id: string;
  /** Echoed back on every later call of one batch run so the recipient gets one notification. */
  bulk_id?: string;
  /** Opaque; the previous answer's `cursor`. Left out on the first call. */
  cursor?: string;
}

const path = (orgSlug: string, userId: string) =>
  `/api/v1/orgs/${encodeURIComponent(orgSlug)}/members/${encodeURIComponent(userId)}/document-ownership`;

/**
 * `null` when the answer is unreadable: the caller treats that as "could not
 * count" rather than "owns nothing", so a drifting server never hides the
 * transfer step by accident.
 */
export async function getMemberDocumentOwnership(
  orgSlug: string,
  userId: string,
): Promise<MemberDocumentOwnership | null> {
  const raw = await request(path(orgSlug, userId));
  return parseWithFallback<MemberDocumentOwnership | null>(raw, OwnershipSchema, null, {
    endpoint: "GET /api/v1/orgs/{org}/members/{userID}/document-ownership",
  });
}

/** One batch of at most 500 documents. `null` on an unreadable answer: the batch is not known to have committed. */
export async function transferMemberDocuments(
  orgSlug: string,
  userId: string,
  input: MemberDocumentsTransferInput,
): Promise<MemberDocumentsTransfer | null> {
  const body: Record<string, string> = { to_user_id: input.to_user_id };
  if (input.bulk_id) body.bulk_id = input.bulk_id;
  if (input.cursor) body.cursor = input.cursor;
  const raw = await request(path(orgSlug, userId), { method: "POST", body });
  return parseWithFallback<MemberDocumentsTransfer | null>(raw, TransferSchema, null, {
    endpoint: "POST /api/v1/orgs/{org}/members/{userID}/document-ownership",
  });
}
