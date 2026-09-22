"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import {
  canSubmitPost,
  POST_BODY_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from "@uniwork/core/chat/post-utils";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { toastApiError } from "../toast-api-error";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";

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

  const resetForm = () => {
    setTitle("");
    setBody("");
    setPinToTop(false);
  };

  useEffect(() => {
    if (!open) resetForm();
  }, [open]);

  const canCreate = canSubmitPost(title, body);

  const handleCreate = () => {
    if (!canCreate || sendMessage.isPending) return;
    if (pinToTop && !canPinToTop) {
      toast.error(t("chat.post_pin_forbidden"));
      return;
    }
    void sendMessage
      .mutateAsync({
        roomId,
        post: {
          title: title.trim(),
          body: body.trim(),
          pin_to_top: pinToTop,
        },
      })
      .then(() => {
        toast.success(t("chat.post_created_toast"));
        onCreated?.();
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        toastApiError(err, t("chat.post_create_failed"));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="lg">
        <FormDialogHeader title={t("chat.post_create_title")} description={t("chat.post_create_description")} />

        <FormDialogBody className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="post-title">{t("chat.post_title_label")}</Label>
            <Input
              id="post-title"
              value={title}
              maxLength={POST_TITLE_MAX_LENGTH}
              placeholder={t("chat.post_title_placeholder")}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="post-body">{t("chat.post_body_label")}</Label>
            <Textarea
              id="post-body"
              value={body}
              maxLength={POST_BODY_MAX_LENGTH}
              rows={8}
              placeholder={t("chat.post_body_placeholder")}
              onChange={(event) => setBody(event.target.value)}
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
          submitLabel={t("chat.post_create_submit")}
          submittingLabel={t("chat.post_create_submitting")}
          submitting={sendMessage.isPending}
          submitDisabled={!canCreate}
          onSubmit={handleCreate}
        />
      </FormDialogContent>
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
