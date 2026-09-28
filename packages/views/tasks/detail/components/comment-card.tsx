"use client";

import type { ReactNode } from "react";
import type { UploadFileFn } from "@uniwork/core/hooks/use-file-upload";
import { TASK_COMMENT_ATTACHMENT_PURPOSE } from "@uniwork/core/constants/upload";
import type { Attachment, TaskComment } from "@uniwork/core/types";
import { useEditorUpload } from "../../../editor";
import { CommentCard } from "../../../comments/comment-card";

/**
 * Task-side adapter: the shared comment card with the task i18n namespace,
 * the `task-comment-*` testids the timeline and its tests use, and the task
 * comment attachment purpose. The `taskId` default and the prop surface are
 * unchanged from the pre-extraction component.
 */
export function TaskCommentCard({
  taskId, comment, replies = [], attachments, uploadFile, highlighted, highlightedId, canModerate = false,
  getActorName = (_type, id) => id, replyComposer,
  onToggleReaction, onEdit, onResolveToggle, onDelete,
}: {
  taskId?: string;
  comment: TaskComment;
  replies?: TaskComment[];
  attachments?: Attachment[];
  uploadFile?: UploadFileFn;
  highlighted?: boolean;
  highlightedId?: string | null;
  canModerate?: boolean;
  getActorName?: (type: string, id: string) => string;
  replyComposer?: ReactNode;
  onToggleReaction: (commentId: string, emoji: string) => void;
  onEdit?: (commentId: string, body: string) => Promise<boolean>;
  onResolveToggle?: (commentId: string, resolved: boolean) => void;
  onDelete?: (commentId: string) => void;
}) {
  const editorUpload = useEditorUpload(uploadFile);

  return (
    <CommentCard
      comment={comment}
      replies={replies}
      tPrefix="tasks.detail"
      testIdPrefix="task-comment"
      attachments={attachments}
      upload={{
        onFile: (file) =>
          editorUpload.upload(file, {
            taskId: taskId ?? comment.task_id,
            purpose: TASK_COMMENT_ATTACHMENT_PURPOSE,
          }),
        uploading: editorUpload.uploading,
      }}
      editorTaskId={taskId ?? comment.task_id}
      highlighted={highlighted}
      highlightedId={highlightedId}
      canModerate={canModerate}
      getActorName={getActorName}
      replyComposer={replyComposer}
      onToggleReaction={onToggleReaction}
      onEdit={onEdit}
      onResolveToggle={onResolveToggle}
      onDelete={onDelete}
    />
  );
}
