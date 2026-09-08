"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateChatRoomSettings } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";

export function ChatRoomRenameDialog({
  open,
  onOpenChange,
  workspaceId,
  roomId,
  currentName,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  roomId: string;
  currentName: string;
  onRenamed?: (name: string) => void;
}) {
  const { t } = useTranslation();
  const updateSettings = useUpdateChatRoomSettings(workspaceId);
  const [name, setName] = useState(currentName);

  const handleOpenChange = (next: boolean) => {
    if (next) setName(currentName);
    onOpenChange(next);
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || updateSettings.isPending) return;
    void updateSettings
      .mutateAsync({ roomId, name: trimmed })
      .then(() => {
        onRenamed?.(trimmed);
        onOpenChange(false);
      })
      .catch(() => {
        // mutation error surfaced by caller if needed
      });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("chat.room_rename_title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="chat-room-rename">{t("chat.room_rename_label")}</Label>
          <Input
            id="chat-room-rename"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSave();
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!name.trim() || updateSettings.isPending} onClick={handleSave}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
