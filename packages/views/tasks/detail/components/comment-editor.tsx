"use client";

import { useTranslation } from "react-i18next";
import type { UploadFileFn } from "@uniwork/core/hooks/use-file-upload";
import { TASK_COMMENT_ATTACHMENT_PURPOSE } from "@uniwork/core/constants/upload";
import type { Attachment } from "@uniwork/core/types";
import { useEditorUpload } from "../../../editor";
import { CommentEditor } from "../../../comments/comment-editor";

/**
 * Task-side adapter: the shared comment editor wired to the task comment
 * attachment purpose. Behaviour and testid are the ones the task surface
 * always had; the implementation lives in packages/views/comments.
 */
export function TaskCommentEditor({ taskId, body, attachments, uploadFile, onSave, onCancel }: {
  taskId: string;
  body: string;
  attachments?: Attachment[];
  uploadFile?: UploadFileFn;
  onSave: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const editorUpload = useEditorUpload(uploadFile);

  return (
    <CommentEditor
      testId="task-comment-editor"
      body={body}
      placeholder={t("tasks.detail.comment_edit_placeholder")}
      onSave={onSave}
      onCancel={onCancel}
      attachments={attachments}
      upload={{
        onFile: (file) =>
          editorUpload.upload(file, { taskId, purpose: TASK_COMMENT_ATTACHMENT_PURPOSE }),
        uploading: editorUpload.uploading,
      }}
      disableMentions
      currentTaskId={taskId}
    />
  );
}
