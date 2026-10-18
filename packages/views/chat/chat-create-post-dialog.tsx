"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import {
  canSubmitPost,
  POST_BODY_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from "@uniwork/core/chat/post-utils";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import {
  CHAT_DIALOG_BODY_CLASS,
  CHAT_DIALOG_CLASS,
  CHAT_FIELD_CLASS,
  CHAT_FIELD_TEXTAREA_CLASS,
  CHAT_LABEL_CLASS,
} from "./chat-dialog-look";
import { chatErrorMessage } from "./chat-error-message";
import { ChatCharCounter, ChatFormFooterNote, RequiredMark } from "./chat-form-parts";
import { PinToTopRow } from "./chat-pin-to-top-row";

const FORM_ID = "chat-create-post-form";

export function ChatCreatePostDialog({
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

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinToTop, setPinToTop] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setTitle("");
    setBody("");
    setPinToTop(false);
    setSubmitError(null);
  }, [open]);

  const canCreate = canSubmitPost(title, body);
  const missingHint = !title.trim()
    ? !body.trim()
      ? t("chat.post_submit_hint_both")
      : t("chat.post_submit_hint_title")
    : !body.trim()
      ? t("chat.post_submit_hint_body")
      : null;

  const handleCreate = () => {
    if (!canCreate || sendMessage.isPending) return;
    setSubmitError(null);
    void sendMessage
      .mutateAsync({
        roomId,
        client_msg_id: newChatClientMsgId(),
        post: {
          title: title.trim(),
          body: body.trim(),
          pin_to_top: pinToTop && canPinToTop,
        },
      })
      .then(() => {
        toast.success(t("chat.post_created_toast"));
        onCreated?.();
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        setSubmitError(chatErrorMessage(err, t, t("chat.post_create_failed")));
      });
  };

  const clearError = () => {
    if (submitError) setSubmitError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="lg" className={`${CHAT_DIALOG_CLASS} sm:max-w-137.5`}>
        <FormDialogHeader title={t("chat.post_create_title")} description={t("chat.post_create_description")} />

        <form
          id={FORM_ID}
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            handleCreate();
          }}
        >
          <FormDialogBody className={`${CHAT_DIALOG_BODY_CLASS} space-y-5`}>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="post-title" className={CHAT_LABEL_CLASS}>
                  {t("chat.post_title_label")}
                  <RequiredMark />
                </Label>
                <ChatCharCounter id="post-title-count" length={title.length} max={POST_TITLE_MAX_LENGTH} always />
              </div>
              <Input
                id="post-title"
                className={`${CHAT_FIELD_CLASS} font-semibold`}
                value={title}
                maxLength={POST_TITLE_MAX_LENGTH}
                aria-required
                aria-describedby="post-title-count"
                placeholder={t("chat.post_title_placeholder")}
                onChange={(event) => {
                  setTitle(event.target.value);
                  clearError();
                }}
                onKeyDown={(event) => {
                  // Enter that confirms an IME word must not submit the form.
                  if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) {
                    event.preventDefault();
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="post-body" className={CHAT_LABEL_CLASS}>
                  {t("chat.post_body_label")}
                  <RequiredMark />
                </Label>
                <ChatCharCounter id="post-body-count" length={body.length} max={POST_BODY_MAX_LENGTH} always />
              </div>
              <Textarea
                id="post-body"
                className={`${CHAT_FIELD_TEXTAREA_CLASS} min-h-53 max-h-96`}
                value={body}
                maxLength={POST_BODY_MAX_LENGTH}
                rows={8}
                aria-required
                aria-describedby="post-body-count"
                placeholder={t("chat.post_body_placeholder")}
                onChange={(event) => {
                  setBody(event.target.value);
                  clearError();
                }}
              />
            </div>

            <PinToTopRow
              id="post-pin-top"
              label={t("chat.post_pin_to_top")}
              checked={pinToTop}
              onCheckedChange={setPinToTop}
              disabledReason={canPinToTop ? undefined : t("chat.post_pin_forbidden")}
            />
          </FormDialogBody>

          <FormDialogFooter
            onCancel={() => onOpenChange(false)}
            cancelVariant="secondary"
            submitLabel={t("chat.post_create_submit")}
            submittingLabel={t("chat.post_create_submitting")}
            submitting={sendMessage.isPending}
            submitDisabled={!canCreate}
            submitType="submit"
            form={FORM_ID}
            leading={
              submitError || missingHint ? <ChatFormFooterNote error={submitError} hint={missingHint} /> : undefined
            }
          />
        </form>
      </FormDialogContent>
    </Dialog>
  );
}
