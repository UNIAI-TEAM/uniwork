"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import { canSubmitNote, NOTE_BODY_MAX_LENGTH } from "@uniwork/core/chat/note-utils";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { chatErrorMessage } from "./chat-error-message";
import { ChatCharCounter, ChatFormFooterNote, nearLimit, RequiredMark } from "./chat-form-parts";
import { PinToTopRow } from "./chat-pin-to-top-row";

const FORM_ID = "chat-create-note-form";

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
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setBody("");
    setPinToTop(false);
    setSubmitError(null);
  }, [open]);

  const canCreate = canSubmitNote(body);

  const handleCreate = () => {
    if (!canCreate || sendMessage.isPending) return;
    setSubmitError(null);
    void sendMessage
      .mutateAsync({
        roomId,
        note: {
          body: body.trim(),
          pin_to_top: pinToTop && canPinToTop,
        },
      })
      .then(() => {
        toast.success(t("chat.note_created_toast"));
        onCreated?.();
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        setSubmitError(chatErrorMessage(err, t, t("chat.note_create_failed")));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="md">
        <FormDialogHeader title={t("chat.note_create_title")} description={t("chat.note_create_description")} />

        <form
          id={FORM_ID}
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            handleCreate();
          }}
        >
          <FormDialogBody className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="note-body">
                  {t("chat.note_body_label")}
                  <RequiredMark />
                </Label>
                <ChatCharCounter id="note-body-count" length={body.length} max={NOTE_BODY_MAX_LENGTH} />
              </div>
              <Textarea
                id="note-body"
                value={body}
                maxLength={NOTE_BODY_MAX_LENGTH}
                rows={6}
                aria-required
                aria-describedby={nearLimit(body.length, NOTE_BODY_MAX_LENGTH) ? "note-body-count" : undefined}
                placeholder={t("chat.note_body_placeholder")}
                onChange={(event) => {
                  setBody(event.target.value);
                  if (submitError) setSubmitError(null);
                }}
              />
            </div>

            <PinToTopRow
              id="note-pin-top"
              label={t("chat.note_pin_to_top")}
              checked={pinToTop}
              onCheckedChange={setPinToTop}
              disabledReason={canPinToTop ? undefined : t("chat.note_pin_forbidden")}
            />
          </FormDialogBody>

          <FormDialogFooter
            onCancel={() => onOpenChange(false)}
            submitLabel={t("chat.note_create_submit")}
            submittingLabel={t("chat.note_create_submitting")}
            submitting={sendMessage.isPending}
            submitDisabled={!canCreate}
            submitType="submit"
            form={FORM_ID}
            leading={
              submitError || !canCreate ? (
                <ChatFormFooterNote error={submitError} hint={canCreate ? null : t("chat.note_submit_hint")} />
              ) : undefined
            }
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
