"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSetChatNickname } from "@uniwork/core/chat";
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

const MAX_NICKNAME_LENGTH = 64;

export function ChatSetNicknameDialog({
  open,
  onOpenChange,
  workspaceId,
  targetUserId,
  targetLabel,
  currentNickname = "",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  targetUserId: string;
  targetLabel: string;
  currentNickname?: string;
  onSaved?: (nickname: string) => void;
}) {
  const { t } = useTranslation();
  const setNickname = useSetChatNickname(workspaceId);
  const [nickname, setNicknameValue] = useState(currentNickname);

  useEffect(() => {
    if (open) setNicknameValue(currentNickname);
  }, [open, currentNickname]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setNicknameValue(currentNickname);
    onOpenChange(next);
  };

  const handleSave = () => {
    if (setNickname.isPending) return;
    const trimmed = nickname.trim();
    if (trimmed.length > MAX_NICKNAME_LENGTH) {
      toast.error(t("chat.nickname_too_long"));
      return;
    }
    void setNickname
      .mutateAsync({ userId: targetUserId, nickname: trimmed })
      .then(() => {
        toast.success(trimmed ? t("chat.nickname_saved") : t("chat.nickname_cleared"));
        onSaved?.(trimmed);
        onOpenChange(false);
      })
      .catch(() => {
        toast.error(t("chat.nickname_save_failed"));
      });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("chat.nickname_title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-caption text-muted-foreground">
            {t("chat.nickname_description", { name: targetLabel })}
          </p>
          <div className="space-y-2">
            <Label htmlFor="chat-nickname">{t("chat.nickname_label")}</Label>
            <Input
              id="chat-nickname"
              value={nickname}
              maxLength={MAX_NICKNAME_LENGTH}
              placeholder={targetLabel}
              onChange={(event) => setNicknameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSave();
              }}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground"
            disabled={setNickname.isPending || !currentNickname.trim()}
            onClick={() => {
              setNicknameValue("");
              void setNickname
                .mutateAsync({ userId: targetUserId, nickname: "" })
                .then(() => {
                  toast.success(t("chat.nickname_cleared"));
                  onSaved?.("");
                  onOpenChange(false);
                })
                .catch(() => toast.error(t("chat.nickname_save_failed")));
            }}
          >
            {t("chat.nickname_clear")}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={setNickname.isPending} onClick={handleSave}>
              {t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
