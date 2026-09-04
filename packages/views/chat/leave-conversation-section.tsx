"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";

export function LeaveConversationSection({
  variant,
  disabled,
  leaving,
  onLeave,
}: {
  variant: "dm" | "group";
  disabled?: boolean;
  leaving?: boolean;
  onLeave: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const description =
    variant === "group"
      ? t("chat.leave_conversation_confirm_description_group")
      : t("chat.leave_conversation_confirm_description_dm");

  const handleConfirm = () => {
    void Promise.resolve(onLeave()).finally(() => {
      setConfirmOpen(false);
    });
  };

  return (
    <>
      <div className="mt-auto space-y-2 border-t border-border pt-4">
        <p className="text-caption text-muted-foreground">
          {variant === "group" ? t("chat.leave_conversation_group_hint") : t("chat.leave_conversation_dm_hint")}
        </p>
        <Button
          type="button"
          variant="destructive"
          className="w-full justify-start gap-2"
          disabled={disabled || leaving}
          onClick={() => setConfirmOpen(true)}
        >
          <LogOut className="size-4" aria-hidden />
          {leaving ? t("chat.leaving_conversation") : t("chat.leave_conversation")}
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.leave_conversation_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={leaving} onClick={handleConfirm}>
              {leaving ? t("chat.leaving_conversation") : t("chat.leave_conversation")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
