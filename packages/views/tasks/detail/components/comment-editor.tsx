"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { Attachment } from "@uniwork/core/types";
import type { UploadFileFn } from "@uniwork/core/hooks/use-file-upload";
import { FileUploadButton } from "@uniwork/ui/components/common/file-upload-button";
import { ContentEditor, type ContentEditorRef, useEditorUpload, useUploadGate } from "../../../editor";

export function TaskCommentEditor({ taskId, body, attachments, uploadFile, onSave, onCancel }: {
  taskId: string;
  body: string;
  attachments?: Attachment[];
  uploadFile?: UploadFileFn;
  onSave: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<ContentEditorRef>(null);
  const [draft, setDraft] = useState(body);
  const [saving, setSaving] = useState(false);
  const uploadGate = useUploadGate(editorRef);
  const editorUpload = useEditorUpload(uploadFile);

  const save = async () => {
    const next = draft.trim();
    if (!next || saving || uploadGate.isBlocked()) return;
    setSaving(true);
    const accepted = await onSave(next);
    setSaving(false);
    if (accepted) onCancel();
  };

  return (
    <div className="space-y-2" data-testid="task-comment-editor">
      <ContentEditor
        ref={editorRef}
        defaultValue={body}
        placeholder={t("tasks.detail.comment_edit_placeholder")}
        className="min-h-20 text-body"
        debounceMs={0}
        attachments={attachments}
        currentTaskId={taskId}
        onUploadFile={(file) => editorUpload.upload(file, { taskId })}
        onUploadingChange={uploadGate.onUploadingChange}
        onUpdate={setDraft}
        onSubmit={() => void save()}
      />
      <div className="flex justify-end gap-2">
        <FileUploadButton
          size="sm"
          multiple
          disabled={editorUpload.uploading || uploadGate.uploading}
          onSelect={(file) => editorRef.current?.uploadFile(file)}
        />
        <span className="flex-1" />
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="button" size="sm" aria-disabled={!draft.trim() || saving || uploadGate.uploading || undefined} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
