"use client";

import { useRef, type KeyboardEvent } from "react";
import { Check, CircleAlert, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DriveConnection } from "@uniwork/core/drive";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import {
  ConfirmDialog,
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../../common/form-dialog";
import { GoogleDriveMark } from "../../common/provider-icons";
import { DriveConsentHint } from "../drive-consent-hint";
import {
  driveConnectCallbackKey,
  type DriveConnectCallbackNotice,
} from "../use-drive-connect-popup";

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

function DrivePickerConnectAlert({
  notice,
}: {
  notice: DriveConnectCallbackNotice;
}) {
  const { t } = useTranslation(undefined, {
    keyPrefix: "settings.integrations.drive",
  });
  return (
    <Alert
      data-testid="drive-picker-connect-notice"
      variant={
        notice.tone === "success"
          ? "success"
          : notice.tone === "destructive"
            ? "destructiveSoft"
            : "muted"
      }
      role={notice.tone === "destructive" ? "alert" : "status"}
    >
      {notice.tone === "success" ? (
        <Check aria-hidden />
      ) : notice.tone === "destructive" ? (
        <CircleAlert aria-hidden />
      ) : null}
      <AlertDescription className="text-caption">
        {t(driveConnectCallbackKey(notice.code, Boolean(notice.email)), {
          email: notice.email ?? "",
        })}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Account selection step when multiple Google Drive accounts are connected,
 * when the single account has lost authorization, or when no account is
 * connected yet (R1-4).
 *
 * Active accounts can be selected (with a visible radio/check indicator,
 * ≥44px coarse-pointer touch target, and radiogroup arrow-key navigation per
 * R1-9 / R1-10); lost accounts are locked (`aria-disabled="true"`) with
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
  onConnectNew,
  onContinue,
  submitting = false,
  connectBusy = false,
  popupPending = false,
  onFocusPopup,
  connectNotice = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: DriveConnection[];
  selectedConnectionId: string | null;
  onSelectConnection: (connectionId: string) => void;
  isConnectionLost: (connection: DriveConnection) => boolean;
  onReconnect: (connection: DriveConnection) => void;
  onConnectNew?: () => void;
  onContinue: () => void;
  submitting?: boolean;
  connectBusy?: boolean;
  popupPending?: boolean;
  onFocusPopup?: () => void;
  connectNotice?: DriveConnectCallbackNotice | null;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "drive.picker" });
  const { t: tDriveSettings } = useTranslation(undefined, {
    keyPrefix: "settings.integrations.drive",
  });
  const radioRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  const hasConnections = connections.length > 0;
  const selectedConnection =
    connections.find((c) => c.id === selectedConnectionId) ?? null;
  const canContinue =
    selectedConnection !== null && !isConnectionLost(selectedConnection);

  // Roving tabIndex target: the selected row, or the first active row, or the first row.
  const tabStopId =
    (selectedConnection && !isConnectionLost(selectedConnection)
      ? selectedConnection.id
      : connections.find((c) => !isConnectionLost(c))?.id) ??
    connections[0]?.id ??
    null;

  const busy = submitting || connectBusy;

  const handleRadioKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    if (submitting || connections.length === 0) return;

    const count = connections.length;
    let delta = 0;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      delta = 1;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      delta = -1;
    } else if (event.key === "Home") {
      event.preventDefault();
      const firstActive =
        connections.find((c) => !isConnectionLost(c)) ?? connections[0];
      if (!firstActive) return;
      if (!isConnectionLost(firstActive)) {
        onSelectConnection(firstActive.id);
      }
      radioRefs.current.get(firstActive.id)?.focus();
      return;
    } else if (event.key === "End") {
      event.preventDefault();
      const reversed = [...connections].reverse();
      const lastActive =
        reversed.find((c) => !isConnectionLost(c)) ?? reversed[0];
      if (!lastActive) return;
      if (!isConnectionLost(lastActive)) {
        onSelectConnection(lastActive.id);
      }
      radioRefs.current.get(lastActive.id)?.focus();
      return;
    } else {
      return;
    }

    event.preventDefault();
    // Advance to the next active connection in direction `delta`; if none are active, move focus only.
    for (let step = 1; step <= count; step += 1) {
      const candidateIndex = (currentIndex + delta * step + count) % count;
      const candidate = connections[candidateIndex];
      if (candidate && !isConnectionLost(candidate)) {
        onSelectConnection(candidate.id);
        radioRefs.current.get(candidate.id)?.focus();
        return;
      }
    }
    const nextFocus = connections[(currentIndex + delta + count) % count];
    if (nextFocus) {
      radioRefs.current.get(nextFocus.id)?.focus();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen);
      }}
    >
      <FormDialogContent size="md" showCloseButton={!submitting}>
        <FormDialogHeader
          title={
            hasConnections
              ? t("account_step.title")
              : t("account_step.empty_title")
          }
          description={
            hasConnections
              ? t("account_step.description")
              : t("account_step.empty_description")
          }
        />
        <FormDialogBody className="space-y-3">
          {connectNotice ? (
            <DrivePickerConnectAlert notice={connectNotice} />
          ) : null}

          {popupPending ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
              <span role="status" className="inline-flex items-center gap-2">
                <Spinner />
                {tDriveSettings("oauth_pending")}
              </span>
              {onFocusPopup ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={onFocusPopup}
                >
                  {tDriveSettings("oauth_show_window")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {!hasConnections || connections.some(isConnectionLost) ? <DriveConsentHint /> : null}

          {hasConnections ? (
            <div
              role="radiogroup"
              aria-label={t("account_step.title")}
              className="space-y-2"
              data-testid="drive-picker-account-list"
            >
              {connections.map((conn, index) => {
                const lost = isConnectionLost(conn);
                const selected = !lost && conn.id === selectedConnectionId;
                const isTabStop = conn.id === tabStopId;
                return (
                  <div
                    key={conn.id}
                    data-testid={`drive-picker-account-${conn.id}`}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-surface-border bg-surface",
                    )}
                  >
                    <button
                      ref={(el) => {
                        radioRefs.current.set(conn.id, el);
                      }}
                      type="button"
                      role="radio"
                      tabIndex={isTabStop ? 0 : -1}
                      aria-checked={selected}
                      aria-disabled={lost || submitting || undefined}
                      onKeyDown={(e) => handleRadioKeyDown(e, index)}
                      onClick={() => {
                        if (!lost && !submitting) {
                          onSelectConnection(conn.id);
                        }
                      }}
                      className={cn(
                        "flex min-h-11 min-w-0 flex-1 items-center gap-3 py-1 text-left pointer-coarse:min-h-11",
                        lost ? "cursor-not-allowed opacity-75" : "cursor-pointer",
                      )}
                    >
                      <span
                        aria-hidden
                        data-testid={`drive-picker-radio-indicator-${conn.id}`}
                        data-checked={selected ? "true" : "false"}
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-surface",
                        )}
                      >
                        {selected ? (
                          <Check aria-hidden className="size-3" />
                        ) : null}
                      </span>
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
                        aria-disabled={busy || undefined}
                        aria-label={t("account_step.reconnect_aria", {
                          email: conn.google_email,
                        })}
                        onClick={() => {
                          if (!busy) onReconnect(conn);
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
          ) : null}

          <DrivePickerDisclosure />
        </FormDialogBody>
        {hasConnections ? (
          <FormDialogFooter
            onCancel={() => onOpenChange(false)}
            cancelLabel={t("account_step.cancel")}
            submitLabel={t("account_step.continue")}
            submittingLabel={t("account_step.opening")}
            submitting={submitting}
            submitDisabled={!canContinue || connectBusy}
            onSubmit={() => {
              if (canContinue && !busy) {
                onContinue();
              }
            }}
          />
        ) : (
          <FormDialogFooter
            onCancel={() => onOpenChange(false)}
            cancelLabel={t("account_step.cancel")}
            submitLabel={t("account_step.connect")}
            submittingLabel={t("account_step.connecting")}
            submitting={connectBusy}
            submitDisabled={busy}
            onSubmit={() => {
              if (!busy) {
                onConnectNew?.();
              }
            }}
          />
        )}
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
