"use client";

import { useEffect, useId } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE } from "@uniwork/core/i18n";
import { classifyDocumentError } from "@uniwork/core/documents/errors";
import { useDocumentCommentRevisions } from "@uniwork/core/documents/hooks-comments";
import type { DocumentComment } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { DocumentCommentBody, type MentionNames } from "./document-comment-body";
import { K } from "./document-comments-keys";
import { formatCollabTime } from "./document-comments-model";

// The edit history of one post (S12 "Lịch sử sửa" rows): read-only for every
// level, newest first, the current text on top. A tombstone answers 409
// `comment_deleted` (the history was deleted with the text): the history does
// not open and the thread shows the deleted frame after the reload.

export function DocumentCommentHistory({
  wsId,
  documentId,
  comment,
  names,
  nameOf,
  onTombstone,
}: {
  wsId: string;
  documentId: string;
  comment: DocumentComment;
  names: MentionNames;
  nameOf: (userId: string) => string;
  onTombstone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LOCALE;
  const headingId = useId();
  const query = useDocumentCommentRevisions(wsId, documentId, comment.id);
  const tombstone = query.isError && classifyDocumentError(query.error).code === "comment_deleted";

  useEffect(() => {
    if (tombstone) onTombstone();
  }, [tombstone, onTombstone]);

  if (tombstone) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-2 space-y-2 rounded-md border border-border bg-muted/40 p-2"
      data-testid={`document-comment-history-${comment.id}`}
    >
      <h4 id={headingId} className="text-caption font-semibold text-foreground">{t(K.collabHistoryTitle)}</h4>
      {query.isPending ? (
        <div aria-busy="true" className="space-y-1">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : query.isError ? (
        <div role="alert" className="flex items-center gap-2 text-caption text-muted-foreground">
          <span className="min-w-0 flex-1">{t(K.collabHistoryError)}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw aria-hidden className="size-3.5" />
            {t(K.collabRetry)}
          </Button>
        </div>
      ) : query.data.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t(K.collabHistoryEmpty)}</p>
      ) : (
        <ol className="space-y-2">
          <li>
            <p className="text-micro font-medium text-muted-foreground">{t(K.collabHistoryCurrent)}</p>
            <DocumentCommentBody body={comment.body} names={names} className="text-caption" />
          </li>
          {query.data.map((revision) => (
            <li key={revision.id} className="border-t border-border/60 pt-2">
              <p className="text-micro font-medium text-muted-foreground">
                {t(K.collabHistoryEntry, {
                  name: nameOf(revision.created_by_id),
                  time: formatCollabTime(revision.created_at, locale),
                })}
              </p>
              <DocumentCommentBody body={revision.body} names={names} className="text-caption" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
