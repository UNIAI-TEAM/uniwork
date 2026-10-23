"use client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTransferHost } from "@uniwork/core/meetings";
import { ConfirmDialog } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";

/**
 * "Hand the host role to …" as a plain (non-destructive) confirm. The roster
 * row menu picks the person; this only asks and sends.
 */
export function TransferHostDialog({
  workspaceId,
  meetingId,
  target,
  onClose,
}: {
  workspaceId: string;
  meetingId: string;
  /** The participant who would become host; null keeps the dialog closed. */
  target: { userId: string; name: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const transfer = useTransferHost(workspaceId, meetingId);

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("meetings.transferConfirmTitle")}
      description={t("meetings.transferConfirm", { name: target?.name ?? "" })}
      confirmLabel={t("meetings.confirmTransfer")}
      destructive={false}
      pending={transfer.isPending}
      onConfirm={() => {
        if (!target) return;
        transfer.mutate(target.userId, {
          onSuccess: () => {
            toast.success(t("meetings.hostTransferred", { name: target.name }));
            onClose();
          },
          onError: (err) => toastApiError(err, t("common.error")),
        });
      }}
    />
  );
}
