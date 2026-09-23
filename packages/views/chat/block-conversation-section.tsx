"use client";

import { Ban, ShieldOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { ConfirmDialog } from "../common/form-dialog";

export function BlockConversationSection({
  blockedByMe,
  blockedMe,
  disabled,
  blocking,
  unblocking,
  onBlock,
  onUnblock,
}: {
  blockedByMe: boolean;
  blockedMe: boolean;
  disabled?: boolean;
  blocking?: boolean;
  unblocking?: boolean;
  onBlock: () => void | Promise<void>;
  onUnblock: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = () => {
    void Promise.resolve(onBlock()).finally(() => {
      setConfirmOpen(false);
    });
  };

  return (
    <>
      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-caption text-muted-foreground">
          {blockedByMe
            ? t("chat.block_active_hint")
            : blockedMe
              ? t("chat.blocked_me_hint")
              : t("chat.block_dm_hint")}
        </p>
        {blockedByMe ? (
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2"
            disabled={disabled || unblocking}
            onClick={() => void onUnblock()}
          >
            <ShieldOff className="size-4" aria-hidden />
            {unblocking ? t("chat.unblocking_user") : t("chat.unblock_user")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="destructive"
            className="w-full justify-start gap-2"
            disabled={disabled || blocking || blockedMe}
            onClick={() => setConfirmOpen(true)}
          >
            <Ban className="size-4" aria-hidden />
            {blocking ? t("chat.blocking_user") : t("chat.block_user")}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("chat.block_confirm_title")}
        description={t("chat.block_confirm_description")}
        confirmLabel={blocking ? t("chat.blocking_user") : t("chat.block_user")}
        pending={blocking}
        onConfirm={handleConfirm}
      />
    </>
  );
}
