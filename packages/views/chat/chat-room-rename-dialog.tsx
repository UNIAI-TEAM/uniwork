"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
import { useUpdateChatRoomSettings } from "@uniwork/core/chat";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";

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
  const [error, setError] = useState<string | null>(null);

  // The parent opens the dialog through `open`, so reset on that, not on onOpenChange.
  useEffect(() => {
    if (!open) return;
    setName(currentName);
    setError(null);
  }, [open, currentName]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed || updateSettings.isPending) return;
    setError(null);
    void updateSettings
      .mutateAsync({ roomId, name: trimmed })
      .then(() => {
        onRenamed?.(trimmed);
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        setError(apiErrorMessage(err) ?? t("chat.room_rename_failed"));
      });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent size="md">
        <FormDialogHeader title={t("chat.room_rename_title")} description={t("chat.room_rename_description")} />
        <FormDialogBody className="space-y-2">
          <Label htmlFor="chat-room-rename">{t("chat.room_rename_label")}</Label>
          <Input
            id="chat-room-rename"
            value={name}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "chat-room-rename-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter") handleSave();
            }}
          />
          {error ? (
            <p id="chat-room-rename-error" role="alert" className="text-caption text-destructive">
              {error}
            </p>
          ) : null}
        </FormDialogBody>
        <FormDialogFooter
          onCancel={() => onOpenChange(false)}
          submitLabel={t("common.save")}
          submittingLabel={t("chat.room_rename_saving")}
          submitting={updateSettings.isPending}
          submitDisabled={!name.trim()}
          onSubmit={handleSave}
        />
      </FormDialogContent>
    </Dialog>
  );
}
