"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";

/**
 * The toast after a delete: it says the item went to the trash and carries
 * Hoàn tác, which runs `undo` (a restore) and reports how that went.
 */
export function useToastMovedToTrash(): (undo: () => Promise<unknown>) => void {
  const { t } = useTranslation();
  return useCallback(
    (undo) => {
      toast.success(t("trash.moved"), {
        duration: 10_000,
        action: {
          label: t("trash.undo"),
          onClick: () => {
            void undo().then(
              () => toast.success(t("trash.restored")),
              (err: unknown) => toastApiError(err, t("trash.restore_failed")),
            );
          },
        },
      });
    },
    [t],
  );
}
