"use client";

import { EyeOff, LogOut } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { ConfirmDialog } from "../common/form-dialog";

export function LeaveConversationSection({
  variant,
  disabled,
  leaving,
  onLeave,
}: {
  variant: "dm" | "group" | "channel";
  disabled?: boolean;
  leaving?: boolean;
  onLeave: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Leaving a DM only hides it on this side and comes back with the next
  // message — consequential, not destructive, so it is not painted red.
  const destructive = variant !== "dm";

  const description =
    variant === "channel"
      ? t("chat.channel.leave_confirm_description")
      : variant === "group"
        ? t("chat.leave_conversation_confirm_description_group")
        : t("chat.leave_conversation_confirm_description_dm");

  const hint =
    variant === "channel"
      ? t("chat.channel.leave_hint")
      : variant === "group"
        ? t("chat.leave_conversation_group_hint")
        : t("chat.leave_conversation_dm_hint");

  const leaveLabel = variant === "channel" ? t("chat.channel.leave") : t("chat.leave_conversation");
  const Icon = destructive ? LogOut : EyeOff;

  const handleConfirm = () => {
    void Promise.resolve(onLeave()).finally(() => {
      setConfirmOpen(false);
    });
  };

  return (
    <>
      <div className="mt-auto space-y-2 border-t border-border pt-4">
        <p className="text-caption text-muted-foreground">{hint}</p>
        <Button
          type="button"
          variant={destructive ? "destructive" : "outline"}
          className="w-full justify-start gap-2"
          disabled={disabled || leaving}
          onClick={() => setConfirmOpen(true)}
        >
          <Icon className="size-4" aria-hidden />
          {leaving ? t("chat.leaving_conversation") : leaveLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          variant === "channel" ? t("chat.channel.leave_confirm_title") : t("chat.leave_conversation_confirm_title")
        }
        description={description}
        confirmLabel={leaving ? t("chat.leaving_conversation") : leaveLabel}
        pending={leaving}
        destructive={destructive}
        onConfirm={handleConfirm}
      />
    </>
  );
}
