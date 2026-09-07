"use client";

import { useEffect, useState } from "react";
import { StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSendChatRoomMessage } from "@uniwork/core/chat";
import { canSubmitNote, NOTE_BODY_MAX_LENGTH } from "@uniwork/core/chat/note-utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { Textarea } from "@uniwork/ui/components/ui/textarea";

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
      .catch(() => {
        toast.error(t("chat.note_create_failed"));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t("chat.note_create_title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
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

          <div className="flex items-start gap-2">
            <Checkbox
              id="note-pin-top"
              checked={pinToTop}
              disabled={!canPinToTop}
              onCheckedChange={(checked) => setPinToTop(checked === true)}
            />
            <Label htmlFor="note-pin-top" id="note-pin-top-label" className="cursor-pointer font-normal leading-snug">
              {t("chat.note_pin_to_top")}
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!canCreate || sendMessage.isPending} onClick={handleCreate}>
            <StickyNote className="size-4" aria-hidden />
            {t("chat.note_create_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
