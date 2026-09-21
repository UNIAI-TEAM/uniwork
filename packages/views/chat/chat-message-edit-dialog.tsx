"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { ChatDialogBody, ChatDialogContent, ChatDialogFooter, ChatDialogHeader } from "./chat-dialog-layout";
import { deserializeMessageBodyToComposerDraft } from "./chat-mention-utils";

export function ChatMessageEditDialog({
  open,
  initialBody,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialBody: string;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (body: string) => void;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState(initialBody);

  useEffect(() => {
    if (open) setBody(deserializeMessageBodyToComposerDraft(initialBody));
  }, [open, initialBody]);

  const canSave = body.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChatDialogContent size="md">
        <ChatDialogHeader title={t("chat.edit_dialog_title")} description={t("chat.edit_dialog_description")} />
        <ChatDialogBody>
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            aria-label={t("chat.edit_dialog_title")}
          />
        </ChatDialogBody>
        <ChatDialogFooter
          onCancel={() => onOpenChange(false)}
          cancelLabel={t("chat.edit_dialog_cancel")}
          submitLabel={t("chat.edit_dialog_save")}
          submittingLabel={t("chat.edit_dialog_saving")}
          submitting={Boolean(saving)}
          submitDisabled={!canSave}
          onSubmit={() => onSave(body.trim())}
        />
      </ChatDialogContent>
    </Dialog>
  );
}
