"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DriveConnection } from "@uniwork/core/drive";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";
import {
  ConfirmDialog,
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../../common/form-dialog";
import { GoogleDriveMark } from "../../common/provider-icons";

/**
 * Single-account sub-line sentence shown beside the menu / trigger when only
 * one Google Drive account is connected (spec §7.1):
 * "UniWork chỉ được quyền với tệp bạn chọn. UniWork chỉ lưu liên kết, nội dung vẫn nằm trên Google Drive."
 */
export function DrivePickerDisclosure({ className }: { className?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "drive.picker" });
  return (
    <p
      data-testid="drive-picker-disclosure"
      className={cn("text-caption text-pretty text-muted-foreground", className)}
    >
      {t("disclosure")}
    </p>
  );
}

/**
 * Account selection step when multiple Google Drive accounts are connected (or
 * when the single account has lost authorization). Active accounts can be
 * selected; lost accounts are locked (`aria-disabled="true"`) with
 * `TriangleAlert` + "Mất kết nối" + "Kết nối lại" (spec §7.1, §7.10).
 */
export function DrivePickerAccountDialog({
  open,
  onOpenChange,
  connections,
  selectedConnectionId,
  onSelectConnection,
  isConnectionLost,
  onReconnect,
  onContinue,
  submitting = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: DriveConnection[];
  selectedConnectionId: string | null;
  onSelectConnection: (connectionId: string) => void;
  isConnectionLost: (connection: DriveConnection) => boolean;
  onReconnect: (connection: DriveConnection) => void;
  onContinue: () => void;
  submitting?: boolean;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "drive.picker" });
  const selectedConnection =
    connections.find((c) => c.id === selectedConnectionId) ?? null;
  const canContinue =
    selectedConnection !== null && !isConnectionLost(selectedConnection);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen);
      }}
    >
      <FormDialogContent size="md" showCloseButton={!submitting}>
        <FormDialogHeader
          title={t("account_step.title")}
          description={t("account_step.description")}
        />
        <FormDialogBody className="space-y-3">
          <div
            role="radiogroup"
            aria-label={t("account_step.title")}
            className="space-y-2"
            data-testid="drive-picker-account-list"
          >
            {connections.map((conn) => {
              const lost = isConnectionLost(conn);
              const selected = !lost && conn.id === selectedConnectionId;
              return (
                <div
                  key={conn.id}
                  data-testid={`drive-picker-account-${conn.id}`}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 transition-colors",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-surface-border bg-surface",
                  )}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={lost || submitting || undefined}
                    onClick={() => {
                      if (!lost && !submitting) {
                        onSelectConnection(conn.id);
                      }
                    }}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3 text-left",
                      lost ? "cursor-not-allowed opacity-75" : "cursor-pointer",
                    )}
                  >
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-surface-muted"
                    >
                      <GoogleDriveMark className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span
                        title={conn.google_email}
                        className="block truncate text-body font-medium text-foreground"
                      >
                        {conn.google_email}
                      </span>
                      {lost ? (
                        <span className="inline-flex items-center gap-1.5 text-caption font-medium text-warning">
                          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                          <span>{t("account_step.status_lost")}</span>
                        </span>
                      ) : (
                        <span className="block text-caption text-muted-foreground">
                          {t("account_step.status_active")}
                        </span>
                      )}
                    </span>
                  </button>

                  {lost ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-disabled={submitting || undefined}
                      aria-label={t("account_step.reconnect_aria", {
                        email: conn.google_email,
                      })}
                      onClick={() => {
                        if (!submitting) onReconnect(conn);
                      }}
                    >
                      <RefreshCw aria-hidden className="size-3.5" />
                      {t("account_step.reconnect")}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>

          <DrivePickerDisclosure />
        </FormDialogBody>
        <FormDialogFooter
          onCancel={() => onOpenChange(false)}
          cancelLabel={t("account_step.cancel")}
          submitLabel={t("account_step.continue")}
          submittingLabel={t("account_step.opening")}
          submitting={submitting}
          submitDisabled={!canContinue}
          onSubmit={() => {
            if (canContinue && !submitting) {
              onContinue();
            }
          }}
        />
      </FormDialogContent>
    </Dialog>
  );
}

/**
 * Confirmation dialog shown before linking files to a task when any picked
 * file has `sharingState !== "shared"` (spec §7.1, Q6):
 * Title: "Liên kết N tệp"
 * Body: "Tên tệp sẽ hiện cho người xem được việc này. Nội dung vẫn chỉ mở trên Google Drive."
 */
export function DrivePickerTaskConfirmDialog({
  open,
  fileCount,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  fileCount: number;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "drive.picker.confirm_dialog" });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onCancel();
      }}
      destructive={false}
      title={t("title", { count: fileCount })}
      description={t("description")}
      confirmLabel={pending ? t("confirming") : t("confirm", { count: fileCount })}
      cancelLabel={t("cancel")}
      pending={pending}
      onConfirm={() => {
        if (!pending) onConfirm();
      }}
    />
  );
}
