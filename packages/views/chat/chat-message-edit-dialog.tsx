"use client";

import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";

export function ChatMessageEditDialog({
  open,
  initialBody,
  saving,
  error,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialBody: string;
  saving?: boolean;
  /** Why the last save failed; the dialog stays open with the text intact. */
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (body: string) => void;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState(initialBody);
  const errorId = useId();
  const original = deserializeMessageBodyToComposerDraft(initialBody);

  useEffect(() => {
    if (open) setBody(deserializeMessageBodyToComposerDraft(initialBody));
  }, [open, initialBody]);

  const trimmed = body.trim();
  const unchanged = trimmed === original.trim();
  const canSave = trimmed.length > 0 && !saving;

  const save = () => {
    if (!canSave) return;
    // Nothing changed: no request, no "Đã sửa" mark on the message.
    if (unchanged) {
      onOpenChange(false);
      return;
    }
    onSave(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="md">
        <FormDialogHeader title={t("chat.edit_dialog_title")} description={t("chat.edit_dialog_description")} />
        <FormDialogBody>
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                save();
              }
            }}
            rows={4}
            aria-label={t("chat.edit_dialog_title")}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {error ? (
            <p id={errorId} role="alert" className="mt-2 text-caption text-destructive">
              {error}
            </p>
          ) : null}
          <p className="mt-1.5 text-caption text-muted-foreground">{t("chat.message_list.edit_shortcut_hint")}</p>
        </FormDialogBody>
        <FormDialogFooter
          onCancel={() => onOpenChange(false)}
          cancelLabel={t("chat.edit_dialog_cancel")}
          submitLabel={t("chat.edit_dialog_save")}
          submittingLabel={t("chat.edit_dialog_saving")}
          submitting={Boolean(saving)}
          submitDisabled={trimmed.length === 0}
          onSubmit={save}
        />
      </FormDialogContent>
    </Dialog>
  );
}
