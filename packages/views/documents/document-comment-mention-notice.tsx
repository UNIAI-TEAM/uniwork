"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShareDocument } from "@uniwork/core/documents/hooks-sharing";
import type { DocumentCommentMentionWithoutAccess } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { K } from "./document-comments-keys";
import { extractMentionTokens, formatMentionList } from "./document-comments-model";

/**
 * The inline notice under a comment the server saved with a non-empty
 * `mentions_without_access` (G8-18, F4): typed/pasted mentions, and people who
 * lost access between picking and sending, only ever get this notice. The
 * share action stays secondary and says it does not notify retroactively.
 */
export function PostSendMentionNotice({
  wsId,
  documentId,
  documentWorkspaceId = "",
  items,
  nameOfId,
  body,
  onShareView,
  testId = "document-comment-post-send-notice",
}: {
  wsId: string;
  documentId: string;
  documentWorkspaceId?: string;
  items: readonly DocumentCommentMentionWithoutAccess[];
  nameOfId?: (userId: string) => string;
  /** The saved comment text; its mention labels name people the server could not. */
  body?: string;
  /** Replaces the share transport call (`POST /api/v1/documents/{id}/shares`). */
  onShareView?: (userId: string) => Promise<void>;
  testId?: string;
}) {
  const { t, i18n } = useTranslation();
  const shareMutation = useShareDocument(wsId, documentId, documentWorkspaceId);
  const [sharedIds, setSharedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [sharing, setSharing] = useState(false);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());

  const tokenLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const token of extractMentionTokens(body ?? "")) {
      if (token.label) map.set(token.userId.toUpperCase(), token.label);
    }
    return map;
  }, [body]);

  const remaining = items.filter((item) => !sharedIds.has(item.user_id.toUpperCase()));
  if (remaining.length === 0) return null;

  const resolveName = (item: DocumentCommentMentionWithoutAccess) =>
    item.display_name || nameOfId?.(item.user_id) || tokenLabels.get(item.user_id.toUpperCase()) || item.user_id;
  const names = formatMentionList(remaining.map(resolveName), i18n.language);
  const shareable = remaining.filter((item) => item.can_share);
  const failed = shareable.filter((item) => failedIds.has(item.user_id.toUpperCase()));

  const shareAll = async () => {
    if (sharing || shareable.length === 0) return;
    setSharing(true);
    const done = new Set<string>();
    const failedNow = new Set<string>();
    for (const item of shareable) {
      try {
        if (onShareView) await onShareView(item.user_id);
        else await shareMutation.mutateAsync({ principal_type: "user", principal_id: item.user_id, level: "view" });
        done.add(item.user_id.toUpperCase());
      } catch {
        failedNow.add(item.user_id.toUpperCase());
      }
    }
    setSharedIds((prev) => new Set([...prev, ...done]));
    setFailedIds(failedNow);
    setSharing(false);
  };

  return (
    <div role="status" data-testid={testId} className="mt-2 space-y-1.5 rounded-md border border-border bg-muted/40 p-2.5 text-caption text-foreground">
      <p>{t(K.collabPostSendNoAccess, { names })}</p>
      {shareable.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-micro text-muted-foreground">{t(K.collabPostSendNoRetroNote)}</p>
          <Button type="button" variant="outline" size="xs" aria-disabled={sharing || undefined} onClick={() => void shareAll()} data-testid={`${testId}-share`}>
            {sharing ? (
              <>
                <Spinner className="size-3" />
                {t(K.collabSharingView)}
              </>
            ) : failed.length > 0 ? (
              t(K.collabRetryShareFor, { failedNames: formatMentionList(failed.map(resolveName), i18n.language) })
            ) : (
              t(K.collabPostSendShareAction)
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
