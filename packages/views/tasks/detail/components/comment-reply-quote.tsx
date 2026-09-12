"use client";

import type { TaskComment } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { commentPreviewText } from "./comment-preview-text";

/**
 * Mirrors the chat reply quote so a reply reads the same way everywhere in the
 * product. Text only: task comments carry no files of their own.
 */
export function TaskCommentReplyQuote({
  comment,
  className,
}: {
  comment: TaskComment;
  className?: string;
}) {
  const author = comment.display_name ?? comment.author_id;
  return (
    <div
      data-testid={`reply-quote-${comment.id}`}
      className={cn(
        "flex min-w-0 items-center gap-2 border-l-2 border-brand/40 pl-2 text-caption text-muted-foreground",
        className,
      )}
    >
      <span className="shrink-0 font-medium">{author}</span>
      <span className="min-w-0 flex-1 truncate">{commentPreviewText(comment.body)}</span>
    </div>
  );
}
