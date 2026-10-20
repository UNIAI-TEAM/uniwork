"use client";

import { useDocumentNoticePage } from "@uniwork/core/notifications";

/**
 * A 404 on a document opened from a notice is a revoked reader as often as a
 * deleted document, and the server answers both alike. The Inbox's own row for
 * this document is the recipient's own answer (`resource_deleted` vs
 * `resource_access_lost`), so the page asks for it fresh before it picks the
 * card. `pending` holds the loading state; a missing row or a failed fetch is
 * not `gone`, so the page keeps the no-access card.
 */
export function useNoticeDocumentGone({
  wsId,
  documentId,
  commentId,
  enabled,
}: {
  wsId: string;
  documentId: string;
  commentId: string;
  enabled: boolean;
}): { pending: boolean; gone: boolean } {
  const page = useDocumentNoticePage({ workspaceId: wsId, documentId, enabled });
  if (!enabled) return { pending: false, gone: false };
  if (page.isPending) return { pending: true, gone: false };
  if (!page.isSuccess) return { pending: false, gone: false };
  const rows = page.data.notifications.filter((n) => n.resource_type === "document" && n.resource_id === documentId);
  const row = rows.find((n) => n.params.comment_id === commentId) ?? rows[0];
  return { pending: false, gone: row?.resource_deleted === true };
}
