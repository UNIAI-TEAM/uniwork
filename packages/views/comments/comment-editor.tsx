"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UploadResult } from "@uniwork/core/hooks/use-file-upload";
import type { Attachment } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { FileUploadButton } from "@uniwork/ui/components/common/file-upload-button";
import { ContentEditor, type ContentEditorRef, useUploadGate } from "../editor";

/**
 * In-place comment edit box, shared by task and document comments (G1-07c).
 *
 * `upload` is optional ON PURPOSE: the task comment pipeline binds
 * `task_comment_attachment` files to a comment, but a document comment binds
 * no attachment rows at all (07a: "no attachment rows bind a document
 * comment"), so the document panel passes nothing and neither the upload
 * button nor the gate exists there. The save handler still awaits the server
 * and keeps the box open on a refusal — never closes over an unproven write.
 */
export function CommentEditor({
  body,
  placeholder,
  onSave,
  onCancel,
  testId = "comment-editor",
  attachments,
  upload,
  disableMentions = false,
  currentTaskId,
}: {
  body: string;
  placeholder: string;
  onSave: (body: string) => Promise<boolean>;
  onCancel: () => void;
  testId?: string;
  attachments?: Attachment[];
  upload?: {
    onFile: (file: File, uploadId: string) => Promise<UploadResult | null>;
    uploading?: boolean;
  };
  disableMentions?: boolean;
  currentTaskId?: string;
}) {
  const { t } = useTranslation();
  const editorRef = useRef<ContentEditorRef>(null);
  const [draft, setDraft] = useState(body);
  const [saving, setSaving] = useState(false);
  const uploadGate = useUploadGate(editorRef);

  const save = async () => {
    const next = draft.trim();
    if (!next || saving || uploadGate.isBlocked()) return;
    setSaving(true);
    const accepted = await onSave(next);
    setSaving(false);
    if (accepted) onCancel();
  };

  return (
    <div className="space-y-2" data-testid={testId}>
      <ContentEditor
        ref={editorRef}
        defaultValue={body}
        placeholder={placeholder}
        ariaLabel={placeholder}
        className="min-h-20 text-body"
        debounceMs={0}
        attachments={attachments}
        currentTaskId={currentTaskId}
        disableMentions={disableMentions}
        onUploadFile={upload ? (file, uploadId) => upload.onFile(file, uploadId) : undefined}
        onUploadingChange={uploadGate.onUploadingChange}
        onUpdate={setDraft}
        onSubmit={() => void save()}
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
        {upload ? (
          <FileUploadButton
            size="sm"
            multiple
            disabled={(upload.uploading ?? false) || uploadGate.uploading}
            onSelect={(file) => editorRef.current?.uploadFile(file)}
          />
        ) : null}
        <Button type="button" size="sm" aria-disabled={!draft.trim() || saving || uploadGate.uploading || undefined} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
