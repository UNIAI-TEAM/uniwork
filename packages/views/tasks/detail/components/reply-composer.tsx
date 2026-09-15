"use client";

import { useTranslation } from "react-i18next";
import type { UploadFileFn } from "@uniwork/core/hooks/use-file-upload";
import type { Attachment, TaskComment } from "@uniwork/core/types";
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
  inline = false,
  attachments,
  uploadFile,
}: {
  taskId: string;
  parent: TaskComment;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel: () => void;
  inline?: boolean;
  attachments?: Attachment[];
  uploadFile?: UploadFileFn;
}) {
  const { t } = useTranslation();
  return (
    <div className={inline ? undefined : "mt-2 space-y-2"} data-testid={`reply-composer-${parent.id}`}>
      {!inline ? <div className="flex items-center justify-between gap-2">
        <TaskCommentReplyQuote comment={parent} className="min-w-0 flex-1" />
        <button
          type="button"
          data-testid={`reply-cancel-${parent.id}`}
          className="shrink-0 text-caption text-muted-foreground underline-offset-2 hover:underline"
          onClick={onCancel}
        >
          {t("tasks.detail.reply_cancel")}
        </button>
      </div> : null}
      <TaskCommentComposer
        taskId={taskId}
        composerKey={`${taskId}:${parent.id}`}
        attachments={attachments}
        uploadFile={uploadFile}
        compact={inline}
        onSubmit={onSubmit}
      />
    </div>
  );
}
