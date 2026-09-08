"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("chat.edit_dialog_title")}</DialogTitle>
        </DialogHeader>
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          aria-label={t("chat.edit_dialog_title")}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("chat.edit_dialog_cancel")}
          </Button>
          <Button
            type="button"
            disabled={saving || body.trim().length === 0}
            onClick={() => onSave(body.trim())}
          >
            {t("chat.edit_dialog_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
