"use client";

import { useState, type RefObject } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, apiErrorMessage } from "@uniwork/core/api";
import { useRebindDriveFile, type DriveFile, type DriveTaskCreationGroup } from "@uniwork/core/drive-library";
import type { AuditEvent } from "@uniwork/core/types";
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
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { EventTime, useAuditLabels } from "../../audit/event-presenter";
import { AppLink } from "../../navigation";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

export interface DriveViewerAccessBlockProps {
  file: DriveFile;
  settingsIntegrationsHref: string;
  /** Optional seam for W3 Picker `setFileIds` to grant read access ("Cho UniWork đọc tệp"). */
  onGrantAccess?: () => void;
  /** Optional seam to trigger reconnect popup directly; defaults to Settings › Integrations link. */
  onReconnect?: (connectionId: string) => void;
}

/**
 * §7.4 block shown in place of the "Bạn mở bằng" row when `viewer_access` is
 * `unknown`, `lost`, or `connection_lost`.
 */
export function DriveViewerAccessBlock({
  file,
  settingsIntegrationsHref,
  onGrantAccess,
  onReconnect,
}: DriveViewerAccessBlockProps) {
  const { t } = useTranslation();

  if (file.viewer_access === "granted") {
    return null;
  }

  if (file.viewer_access === "lost") {
    const email = file.viewer_account_email;
    return (
      <div
        role="status"
        className="flex flex-col gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-caption text-foreground"
      >
        <div className="flex items-start gap-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            {email
              ? t("driveLibrary.detail.viewer_access.lost_body", { email })
              : t("driveLibrary.detail.viewer_access.lost_body_no_email")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onGrantAccess ? (
            <Button type="button" size="sm" onClick={onGrantAccess}>
              {t("driveLibrary.detail.viewer_access.grant_button")}
            </Button>
          ) : (
            <AppLink href={settingsIntegrationsHref} className={buttonVariants({ size: "sm" })}>
              {t("driveLibrary.detail.viewer_access.grant_button")}
            </AppLink>
          )}
        </div>
      </div>
    );
  }

  if (file.viewer_access === "connection_lost") {
    const email = file.viewer_account_email;
    return (
      <div
        role="status"
        className="flex flex-col gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-caption text-foreground"
      >
        <div className="flex items-start gap-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            {email
              ? t("driveLibrary.detail.viewer_access.connection_lost_body", { email })
              : t("driveLibrary.detail.viewer_access.connection_lost_body_no_email")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onReconnect && file.viewer_connection_id ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onReconnect(file.viewer_connection_id!)}>
              <RefreshCw aria-hidden className="size-3.5" />
              {t("driveLibrary.detail.viewer_access.reconnect_button")}
            </Button>
          ) : (
            <AppLink
              href={settingsIntegrationsHref}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              {t("driveLibrary.detail.viewer_access.reconnect_button")}
            </AppLink>
          )}
        </div>
      </div>
    );
  }

  // viewer_access === "unknown" (or any future unrecognized state)
  return (
    <div
      role="status"
      className="flex flex-col gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-caption text-foreground"
    >
      <p>
        <strong className="font-semibold">{t("driveLibrary.detail.viewer_access.unknown_lead")}</strong>{" "}
        {t("driveLibrary.detail.viewer_access.unknown_body", { name: file.created_by_name })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onGrantAccess ? (
          <Button type="button" size="sm" onClick={onGrantAccess}>
            {t("driveLibrary.detail.viewer_access.grant_button")}
          </Button>
        ) : (
          <AppLink href={settingsIntegrationsHref} className={buttonVariants({ size: "sm" })}>
            {t("driveLibrary.detail.viewer_access.grant_button")}
          </AppLink>
        )}
      </div>
      <p className="text-caption text-muted-foreground">
        {t("driveLibrary.detail.viewer_access.unknown_note")}
      </p>
    </div>
  );
}

export interface DriveUnlinkConfirmSectionProps {
  usedInCount: number;
  pending: boolean;
  onConfirm: () => Promise<boolean> | boolean;
}

/**
 * §7.7 AlertDialog confirmation for unlinking a Drive file from the workspace.
 */
export function DriveUnlinkConfirmSection({
  usedInCount,
  pending,
  onConfirm,
}: DriveUnlinkConfirmSectionProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = pending || submitting;

  const title =
    usedInCount > 0
      ? t("driveLibrary.detail.unlink.confirm_title", { count: usedInCount })
      : t("driveLibrary.detail.unlink.confirm_title_zero");

  const handleConfirm = async () => {
    if (busy) return;
    setSubmitting(true);
    const ok = await onConfirm();
    if (ok) {
      setConfirming(false);
    } else {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={submitting}
        className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        {t("driveLibrary.detail.unlink.button")}
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={(next) => (!next && !busy ? setConfirming(false) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("driveLibrary.detail.unlink.confirm_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("driveLibrary.detail.unlink.keep")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void handleConfirm()}
            >
              {t(
                busy
                  ? "driveLibrary.detail.unlink.submitting"
                  : "driveLibrary.detail.unlink.confirm",
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export interface DriveRebindSectionProps {
  wsId: string;
  file: DriveFile;
  connections: readonly DriveConnectionSummary[];
  /** Seam for W3 Picker before calling `rebindDriveFile`; rendered only when `onRebind` is passed. */
  onRebind?: (connectionId: string) => Promise<void> | void;
}

/**
 * §7.7 "Liên kết lại bằng tài khoản khác" button + account picker dialog.
 * Visible only when `onRebind` is passed, `can_rebind` is true, and (`Boolean(access_lost_at)` or `bound_connection_lost`).
 */
export function DriveRebindSection({
  wsId,
  file,
  connections,
  onRebind,
}: DriveRebindSectionProps) {
  const { t } = useTranslation();
  const rebindMutation = useRebindDriveFile(wsId, file.id);
  const [open, setOpen] = useState(false);

  const activeConnections = connections.filter((c) => !c.needs_reconnect);
  const defaultConnectionId =
    activeConnections.find((c) => c.id !== file.connection_id)?.id ??
    activeConnections[0]?.id ??
    "";
  const [selectedId, setSelectedId] = useState<string>(defaultConnectionId);

  const showRebind =
    Boolean(onRebind) &&
    file.can_rebind &&
    (Boolean(file.access_lost_at) || file.bound_connection_lost);
  if (!showRebind || !onRebind) {
    return null;
  }

  const resolvedConnectionId =
    activeConnections.some((c) => c.id === selectedId) ? selectedId : defaultConnectionId;

  const handleSubmit = async () => {
    if (!resolvedConnectionId) return;
    try {
      await onRebind(resolvedConnectionId);
      await rebindMutation.mutateAsync({ connection_id: resolvedConnectionId });
      setOpen(false);
    } catch (error) {
      const msg = error instanceof ApiError ? apiErrorMessage(error) : null;
      toast.error(msg ?? t("driveLibrary.detail.rebind.failed"));
    }
  };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setSelectedId(defaultConnectionId);
          setOpen(true);
        }}
      >
        <RefreshCw aria-hidden className="size-3.5" />
        {t("driveLibrary.detail.rebind.button")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("driveLibrary.detail.rebind.dialog_title")}</DialogTitle>
            <DialogDescription>{t("driveLibrary.detail.rebind.dialog_description")}</DialogDescription>
          </DialogHeader>

          {activeConnections.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              {t("driveLibrary.detail.rebind.no_active_accounts")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p id="drive-rebind-account-legend" className="mb-1 text-caption font-medium text-foreground">
                {t("driveLibrary.detail.rebind.account_label")}
              </p>
              <RadioGroup
                aria-labelledby="drive-rebind-account-legend"
                value={resolvedConnectionId}
                onValueChange={(value) => {
                  if (typeof value === "string" && value) setSelectedId(value);
                }}
              >
                {activeConnections.map((conn) => (
                  <label
                    key={conn.id}
                    htmlFor={`rebind-connection-${conn.id}`}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-body hover:bg-accent/50"
                  >
                    <RadioGroupItem id={`rebind-connection-${conn.id}`} value={conn.id} />
                    <span className="truncate">{conn.google_email}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={rebindMutation.isPending}
              onClick={() => setOpen(false)}
            >
              {t("driveLibrary.detail.rebind.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!resolvedConnectionId || rebindMutation.isPending}
              aria-busy={rebindMutation.isPending || undefined}
              onClick={() => void handleSubmit()}
            >
              {t(
                rebindMutation.isPending
                  ? "driveLibrary.detail.rebind.submitting"
                  : "driveLibrary.detail.rebind.submit",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatActivityLine(
  event: AuditEvent,
  currentUserId: string | null,
  memberNames: ReadonlyMap<string, string>,
  fallbackActionLabel: (action: string) => string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const actor =
    currentUserId && event.actor_id === currentUserId
      ? t("driveLibrary.detail.activity.actor_you")
      : memberNames.get(event.actor_id) || t("driveLibrary.detail.activity.actor_unknown");
  switch (event.action) {
    case "drive_task_proposal.tasks_created": {
      const rawCount = event.metadata?.count;
      const count = typeof rawCount === "number" && rawCount > 0 ? rawCount : 1;
      return t("driveLibrary.detail.activity.tasks_created", { actor, count });
    }
    case "drive_file.linked":
      return t("driveLibrary.detail.activity.linked", { actor });
    case "drive_file.rebound":
      return t("driveLibrary.detail.activity.rebound", { actor });
    case "drive_file.access_granted":
      return t("driveLibrary.detail.activity.access_granted", { actor });
    case "drive_file.access_changed":
      return t("driveLibrary.detail.activity.access_changed", { actor });
    case "drive_file.access_lost":
      return t("driveLibrary.detail.activity.access_lost");
    case "drive_file.unlinked":
      return t("driveLibrary.detail.activity.unlinked", { actor });
    default:
      return fallbackActionLabel(event.action);
  }
}

export interface DriveFileActivitySectionProps {
  events: AuditEvent[];
  isPending: boolean;
  isError: boolean;
  currentUserId: string | null;
  memberNames: ReadonlyMap<string, string>;
}

/**
 * "Hoạt động trong UniWork" card on 4.2 (Q7: never renders "opened" rows).
 */
export function DriveFileActivitySection({
  events,
  isPending,
  isError,
  currentUserId,
  memberNames,
}: DriveFileActivitySectionProps) {
  const { t } = useTranslation();
  const auditLabels = useAuditLabels();
  const activityEvents = events.filter((e) => !e.action.endsWith(".opened"));

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-background p-5 text-caption">
      <h2 className="text-body font-semibold text-foreground">
        {t("driveLibrary.detail.activity.title")}
      </h2>
      {isPending ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : isError ? (
        <p className="text-caption text-destructive">
          {t("driveLibrary.detail.activity.error")}
        </p>
      ) : activityEvents.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {t("driveLibrary.detail.activity.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {activityEvents.map((event) => (
            <li key={event.id} className="text-caption text-muted-foreground">
              <span className="text-foreground">
                {formatActivityLine(event, currentUserId, memberNames, auditLabels.action, t)}
              </span>{" "}
              <span aria-hidden>·</span>{" "}
              <EventTime iso={event.occurred_at} className="text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface DriveTasksCreatedSectionProps {
  sectionRef: RefObject<HTMLDivElement | null>;
  creations: readonly DriveTaskCreationGroup[];
  totalCreatedCount: number;
  formatDate: (iso: string | undefined) => string;
  taskHref: (taskId: string) => string;
}

export function DriveTasksCreatedSection({ sectionRef, creations, totalCreatedCount, formatDate, taskHref }: DriveTasksCreatedSectionProps) {
  const { t } = useTranslation();
  if (creations.length === 0 && totalCreatedCount <= 0) return null;

  return (
    <div id="drive-tasks-created" ref={sectionRef} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-foreground">{t("driveLibrary.detail.tasks_created.title")}</h2>
        {totalCreatedCount > 0 ? (
          <span className="text-caption text-muted-foreground">{t("driveLibrary.detail.tasks_created.summary", { count: totalCreatedCount })}</span>
        ) : null}
      </div>
      {creations.map((group) => (
        <div key={group.proposal_id} className="flex flex-col gap-1.5">
          <div className="text-caption font-medium text-muted-foreground">
            {t("driveLibrary.detail.tasks_created.group", { date: formatDate(group.created_at), name: group.created_by_name, count: group.tasks.length })}
          </div>
          <ul className="flex flex-col gap-1">
            {group.tasks.map((task) => (
              <li key={task.task_id}>
                <AppLink href={taskHref(task.task_id)} className="inline-flex min-h-8 items-center text-body text-foreground hover:underline pointer-coarse:min-h-11">
                  {t("driveLibrary.detail.used_in.task_row", { identifier: task.identifier, title: task.title })}
                </AppLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
