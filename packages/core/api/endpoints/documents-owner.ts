import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Per-document owner transfer (access addendum §2.1, §4.2; W-DOC06, UNI-1630).
// The answer names the new ACL owner; the hook refuses one that does not
// match the request, so a malformed 200 never reads as a transfer.

const enc = encodeURIComponent;

/** What the previous owner keeps after the transfer; the server defaults to edit. */
export type PreviousOwnerLevel = "edit" | "comment" | "view" | "none";

export interface TransferDocumentOwnerBody {
  user_id: string;
  previous_owner_level?: PreviousOwnerLevel;
}

/** DocumentOwnerSDO. The share id is empty when the previous owner kept nothing. */
const DocumentOwnerTransferSchema = z.object({
  document_id: z.string(),
  acl_owner_id: z.string(),
  previous_owner_id: z.string().catch("").default(""),
  previous_owner_share_id: z.string().catch("").default(""),
});
export type DocumentOwnerTransfer = z.infer<typeof DocumentOwnerTransferSchema>;

/** PUT /api/v1/documents/{documentID}/owner — hand the ACL owner to an active
 *  member of the document's workspace (canAdminister()). Refusals:
 *  422 owner_target_not_member, 403 break_glass_required (an admin taking a
 *  restricted document for themselves), 409 document_owned_by_work_product. */
export async function transferDocumentOwner(
  documentId: string,
  body: TransferDocumentOwnerBody,
  signal?: AbortSignal,
): Promise<DocumentOwnerTransfer | null> {
  const raw = await request(`/api/v1/documents/${enc(documentId)}/owner`, {
    method: "PUT",
    body,
    signal,
  });
  return parseWithFallback<DocumentOwnerTransfer | null>(raw, DocumentOwnerTransferSchema, null, {
    endpoint: "PUT /api/v1/documents/{id}/owner",
  });
}
