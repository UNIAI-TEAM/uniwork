"use client";

import { useTranslation } from "react-i18next";
import type { TaskComment } from "@uniwork/core/types";
import { TaskCommentReplyQuote } from "./comment-reply-quote";
import { TaskCommentComposer } from "./comment-composer";

/**
 * The reply box. It reuses the main composer rather than growing a second one,
 * so a reply keeps the same editor, the same upload gate, and the same
 * draft-survives-failure contract as a top-level comment.
 */
export function TaskReplyComposer({
  taskId,
  parent,
  onSubmit,
  onCancel,
}: {
  taskId: string;
  parent: TaskComment;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 space-y-2" data-testid={`reply-composer-${parent.id}`}>
      <div className="flex items-center justify-between gap-2">
        <TaskCommentReplyQuote comment={parent} className="min-w-0 flex-1" />
        <button
          type="button"
          data-testid={`reply-cancel-${parent.id}`}
          className="shrink-0 text-caption text-muted-foreground underline-offset-2 hover:underline"
          onClick={onCancel}
        >
          {t("tasks.detail.reply_cancel")}
        </button>
      </div>
      <TaskCommentComposer taskId={taskId} composerKey={`${taskId}:${parent.id}`} onSubmit={onSubmit} />
    </div>
  );
}
