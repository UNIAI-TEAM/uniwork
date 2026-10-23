"use client";

import { useCallback } from "react";
import type { UploadFileFn } from "@uniwork/core/hooks/use-file-upload";
import { TASK_COMMENT_ATTACHMENT_PURPOSE } from "@uniwork/core/constants/upload";
import type { Attachment } from "@uniwork/core/types";
import { useCommentDraftStore } from "@uniwork/core/tasks/stores/comment-draft-store";
import { useEditorUpload } from "../../../editor";
import { CommentComposer } from "../../../comments/comment-composer";

/**
 * Task-side adapter: the shared lazy comment composer wired to the task draft
 * store and the task comment attachment purpose. The behavioural contract
 * (draft survives failure, debounced persistence, refocus-after-send for
 * replies) is the shared composer's; this file only binds the task store and
 * the task upload context.
 */
export function TaskCommentComposer({
  taskId,
  composerKey,
  attachments,
  uploadFile,
  compact = false,
  refocusAfterSend = false,
  onSubmit,
}: {
  taskId: string;
  /** Distinguishes composers on the same task: the main box and each reply box. */
  composerKey?: string;
  attachments?: Attachment[];
  uploadFile?: UploadFileFn;
  compact?: boolean;
  /** Thread replies keep the caret for the next message (baseline ReplyInput). */
  refocusAfterSend?: boolean;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const key = composerKey ?? taskId;
  const draft = useCommentDraftStore((state) => state.draftFor(key));
  const setStoredDraft = useCommentDraftStore((state) => state.setDraft);
  const clearStoredDraft = useCommentDraftStore((state) => state.clearDraft);
  const editorUpload = useEditorUpload(uploadFile);

  const setDraft = useCallback(
    (body: string) => setStoredDraft(key, body),
    [key, setStoredDraft],
  );
  const clearDraft = useCallback(() => clearStoredDraft(key), [key, clearStoredDraft]);

  return (
    <CommentComposer
      tPrefix="tasks.detail"
      resetKey={key}
      draft={draft}
      setDraft={setDraft}
      clearDraft={clearDraft}
      onSubmit={onSubmit}
      compact={compact}
      refocusAfterSend={refocusAfterSend}
      testId="task-comment-composer"
      shellTestId="task-comment-composer-shell"
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
