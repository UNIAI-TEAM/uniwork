"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSetChatNickname } from "@uniwork/core/chat";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { toastApiError } from "../toast-api-error";
import { ChatDialogBody, ChatDialogContent, ChatDialogFooter, ChatDialogHeader } from "./chat-dialog-layout";

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
  // Which of the two writes is running, so only that button says "…ing".
  const [pendingAction, setPendingAction] = useState<"save" | "clear" | null>(null);

  useEffect(() => {
    if (open) setNicknameValue(currentNickname);
  }, [open, currentNickname]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setNicknameValue(currentNickname);
    onOpenChange(next);
  };

  const write = (value: string, action: "save" | "clear") => {
    if (setNickname.isPending) return;
    setPendingAction(action);
    void setNickname
      .mutateAsync({ userId: targetUserId, nickname: value })
      .then(() => {
        toast.success(value ? t("chat.nickname_saved") : t("chat.nickname_cleared"));
        onSaved?.(value);
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        toastApiError(err, t("chat.nickname_save_failed"));
      })
      .finally(() => setPendingAction(null));
  };

  const handleSave = () => write(nickname.trim(), "save");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <ChatDialogContent size="md">
        <ChatDialogHeader
          title={t("chat.nickname_title")}
          description={t("chat.nickname_description", { name: targetLabel })}
        />
        <ChatDialogBody className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="chat-nickname">{t("chat.nickname_label")}</Label>
            <span id="chat-nickname-count" className="text-caption tabular-nums text-muted-foreground">
              {nickname.length}/{MAX_NICKNAME_LENGTH}
            </span>
          </div>
          <Input
            id="chat-nickname"
            value={nickname}
            maxLength={MAX_NICKNAME_LENGTH}
            placeholder={targetLabel}
            aria-describedby="chat-nickname-count"
            onChange={(event) => setNicknameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter") handleSave();
            }}
          />
        </ChatDialogBody>
        <ChatDialogFooter
          onCancel={() => handleOpenChange(false)}
          submitLabel={t("common.save")}
          submittingLabel={t("chat.nickname_saving")}
          submitting={pendingAction === "save"}
          submitDisabled={setNickname.isPending}
          onSubmit={handleSave}
          leading={
            currentNickname.trim() ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 text-muted-foreground"
                disabled={setNickname.isPending}
                onClick={() => {
                  setNicknameValue("");
                  write("", "clear");
                }}
              >
                {pendingAction === "clear" ? t("chat.nickname_clearing") : t("chat.nickname_clear")}
              </Button>
            ) : null
          }
        />
      </ChatDialogContent>
    </Dialog>
  );
}
