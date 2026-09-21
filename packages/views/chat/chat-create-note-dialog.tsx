"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import { canSubmitNote, NOTE_BODY_MAX_LENGTH } from "@uniwork/core/chat/note-utils";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { toastApiError } from "../toast-api-error";
import { ChatDialogBody, ChatDialogContent, ChatDialogFooter, ChatDialogHeader } from "./chat-dialog-layout";

export function ChatCreateNoteDialog({
  open,
  onOpenChange,
  workspaceId,
  roomId,
  canPinToTop,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  roomId: string;
  canPinToTop: boolean;
  onCreated?: () => void;
}) {
  const { t } = useTranslation();
  const sendMessage = useSendChatRoomMessage(workspaceId);

  const [body, setBody] = useState("");
  const [pinToTop, setPinToTop] = useState(false);

  const resetForm = () => {
    setBody("");
    setPinToTop(false);
  };

  useEffect(() => {
    if (!open) resetForm();
  }, [open]);

  const canCreate = canSubmitNote(body);

  const handleCreate = () => {
    if (!canCreate || sendMessage.isPending) return;
    if (pinToTop && !canPinToTop) {
      toast.error(t("chat.note_pin_forbidden"));
      return;
    }
    void sendMessage
      .mutateAsync({
        roomId,
        note: {
          body: body.trim(),
          pin_to_top: pinToTop,
        },
      })
      .then(() => {
        toast.success(t("chat.note_created_toast"));
        onCreated?.();
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        toastApiError(err, t("chat.note_create_failed"));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChatDialogContent size="md">
        <ChatDialogHeader title={t("chat.note_create_title")} description={t("chat.note_create_description")} />

        <ChatDialogBody className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="note-body">{t("chat.note_body_label")}</Label>
            <Textarea
              id="note-body"
              value={body}
              maxLength={NOTE_BODY_MAX_LENGTH}
              rows={6}
              placeholder={t("chat.note_body_placeholder")}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>

          <PinToTopRow
            id="note-pin-top"
            label={t("chat.note_pin_to_top")}
            checked={pinToTop}
            onCheckedChange={setPinToTop}
            disabledReason={canPinToTop ? undefined : t("chat.note_pin_forbidden")}
          />
        </ChatDialogBody>

        <ChatDialogFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={t("chat.note_create_submit")}
          submittingLabel={t("chat.note_create_submitting")}
          submitting={sendMessage.isPending}
          submitDisabled={!canCreate}
          onSubmit={handleCreate}
        />
      </ChatDialogContent>
    </Dialog>
  );
}

/**
 * The same Switch the poll dialog uses for "pin to top". When the viewer may
 * not pin, the control stays visible but off, and the caption says why.
 */
function PinToTopRow({
  id,
  label,
  checked,
  onCheckedChange,
  disabledReason,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabledReason?: string;
}) {
  const labelId = `${id}-label`;
  const reasonId = `${id}-reason`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <Label id={labelId} htmlFor={id} className="font-normal text-body text-foreground">
          {label}
        </Label>
        <Switch
          id={id}
          aria-labelledby={labelId}
          aria-describedby={disabledReason ? reasonId : undefined}
          checked={checked && !disabledReason}
          disabled={Boolean(disabledReason)}
          onCheckedChange={onCheckedChange}
        />
      </div>
      {disabledReason ? (
        <p id={reasonId} className="text-caption text-muted-foreground">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
