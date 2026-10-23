"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { commentPreviewOrFallback } from "./comment-preview-text";
import type { CommentLike } from "./comment-types";

/**
 * Mirrors the chat reply quote so a reply reads the same way everywhere in the
 * product. Text only: document comments carry no files and task comments keep
 * their own attachment pipeline outside the quote.
 *
 * `tPrefix` selects the surface's i18n namespace (`tasks.detail` or
 * `documents.comments`); both dictionaries carry the same key suffixes.
 */
export function CommentReplyQuote({
  comment,
  tPrefix,
  className,
}: {
  comment: CommentLike;
  tPrefix: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const author = comment.display_name ?? comment.author_id ?? "";
  // A comment that is only a code fence (or other stripped syntax) previews
  // as "" — show a label instead of a blank line rather than nothing.
  const preview = commentPreviewOrFallback(
    comment.body,
    t(`${tPrefix}.comment_preview_empty`),
  );
  return (
    <div
      data-testid={`reply-quote-${comment.id}`}
      className={cn(
        "flex min-w-0 items-center gap-2 border-l-2 border-brand/40 pl-2 text-caption text-muted-foreground",
        className,
      )}
    >
      <span className="shrink-0 font-medium">{author}</span>
      <span className="min-w-0 flex-1 truncate">{preview}</span>
    </div>
  );
}
