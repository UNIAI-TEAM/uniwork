"use client";

import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import {
  canSubmitPost,
  POST_BODY_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from "@uniwork/core/chat/post-utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Textarea } from "@uniwork/ui/components/ui/textarea";

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
      .catch(() => {
        toast.error(t("chat.post_create_failed"));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t("chat.post_create_title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
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

          <div className="flex items-start gap-2">
            <Checkbox
              id="post-pin-top"
              checked={pinToTop}
              disabled={!canPinToTop}
              onCheckedChange={(checked) => setPinToTop(checked === true)}
            />
            <Label htmlFor="post-pin-top" id="post-pin-top-label" className="cursor-pointer font-normal leading-snug">
              {t("chat.post_pin_to_top")}
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!canCreate || sendMessage.isPending} onClick={handleCreate}>
            <Megaphone className="size-4" aria-hidden />
            {t("chat.post_create_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
