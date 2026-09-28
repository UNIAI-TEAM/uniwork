"use client";

import type { TaskComment } from "@uniwork/core/types";
import { CommentReplyQuote } from "../../../comments/comment-reply-quote";

/**
 * Task-side adapter: the shared reply quote with the task i18n namespace.
 * Mirrors the chat reply quote so a reply reads the same way everywhere.
 */
export function TaskCommentReplyQuote({
  comment,
  className,
}: {
  comment: TaskComment;
  className?: string;
}) {
  return <CommentReplyQuote comment={comment} tPrefix="tasks.detail" className={className} />;
}
