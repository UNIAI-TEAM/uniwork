"use client";

import { useState, type ReactNode } from "react";
import { Ellipsis, ExternalLink, RefreshCw, Trash, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useDriveConnections,
  useGrantDriveFileAccess,
  useRemoveTaskDriveFile,
  type DriveTaskFileCard as DriveTaskFileCardDTO,
} from "@uniwork/core/drive";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../../../common/form-dialog";
import { shortDateFormat } from "../../../common/date-pill";
import {
  DocumentTypeIcon,
  documentFormatLabel,
} from "../../../documents/document-type-icon";
import { DriveConsentHint } from "../../../integrations/drive-consent-hint";
import {
  useDrivePicker,
  type DrivePickerAdapter,
} from "../../../integrations/drive-picker";
import {
  driveConnectCallbackKey,
  useDriveConnectPopup,
} from "../../../integrations/use-drive-connect-popup";
import { relativeTime } from "../../../notifications/relative-time";
import { toastApiError } from "../../../toast-api-error";

export interface DriveTaskFileCardActionsSlotContext {
  card: DriveTaskFileCardDTO;
  /** True when the viewer does not have `granted` access on an active connection. */
  blocked: boolean;
  /** Localized tooltip / `aria-describedby` reason when `blocked` is true. */
  blockedReason: string;
}

export interface DriveTaskFileCardProps {
  workspaceId: string;
  taskId: string;
  card: DriveTaskFileCardDTO;
  /**
   * Typed extension slot for W6 ("Tạo việc từ tài liệu") and docs-lane W9 ("Hỏi UNI")
   * actions. Accepts either a ReactNode or a render function receiving the card and
   * viewer-access blocked state so downstream actions can render with `aria-disabled`
   * when `viewer_access !== "granted"`.
   */
  actions?: ReactNode | ((context: DriveTaskFileCardActionsSlotContext) => ReactNode);
  pickerAdapter?: DrivePickerAdapter;
}

function formatShortDate(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, shortDateFormat(String(date.getFullYear())));
}

function buildMetadataLine(
  card: DriveTaskFileCardDTO,
  tRoot: (key: string) => string,
  tCard: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): string {
  const parts: string[] = [documentFormatLabel(card.icon_kind, tRoot)];

  if (card.viewer_access === "unknown") {
    const linker = card.created_by_name?.trim() || card.bound_by_name?.trim() || "";
    if (linker) {
      parts.push(tCard("meta_linked_by", { name: linker }));
    }
  } else {
    const accountEmail =
      card.viewer_account_email?.trim() || card.bound_account_email?.trim() || "";
    if (accountEmail) {
      let accountSegment = tCard("meta_drive_account", { email: accountEmail });
      if (
        card.bound_by_id &&
        card.created_by &&
        card.bound_by_id !== card.created_by &&
        card.bound_by_name?.trim()
      ) {
        accountSegment = `${accountSegment} ${tCard("meta_rebound_by", {
          name: card.bound_by_name.trim(),
        })}`;
      }
      parts.push(accountSegment);
    }
  }

  const modifiedRelative = card.drive_modified_at
    ? relativeTime(card.drive_modified_at, locale) ||
      formatShortDate(card.drive_modified_at, locale)
    : "";
  const modifiedBy = card.drive_modified_by_display?.trim() ?? "";

  if (modifiedBy && modifiedRelative) {
    parts.push(
      tCard("meta_modified_by", { name: modifiedBy, time: modifiedRelative }),
    );
  } else if (modifiedRelative) {
    parts.push(tCard("meta_modified", { time: modifiedRelative }));
  } else if (card.owner_display?.trim()) {
    parts.push(tCard("meta_owner", { owner: card.owner_display.trim() }));
  }

  return parts.filter(Boolean).join(" · ");
}

function OpenOnDriveLink({
  openUrl,
  label,
}: {
  openUrl: string | undefined;
  label: string;
}) {
  if (!openUrl) return null;
  return (
    <a
      href={openUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      <ExternalLink className="size-3.5" aria-hidden />
      {label}
    </a>
  );
}

function CardMoreMenu({
  canRemoveFromTask,
  moreActionsAria,
  unlinkLabel,
  onRequestUnlink,
}: {
  canRemoveFromTask: boolean;
  moreActionsAria: string;
  unlinkLabel: string;
  onRequestUnlink: () => void;
}) {
  if (!canRemoveFromTask) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={moreActionsAria}
          />
        }
      >
        <Ellipsis className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" onClick={onRequestUnlink}>
          <Trash className="size-4" aria-hidden />
          {unlinkLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DriveTaskFileCard({
  workspaceId,
  taskId,
  card,
  actions,
  pickerAdapter,
}: DriveTaskFileCardProps) {
  const { t: tRoot, i18n } = useTranslation();
  const { t } = useTranslation(undefined, { keyPrefix: "drive.card" });
  const { t: tDriveSettings } = useTranslation(undefined, {
    keyPrefix: "settings.integrations.drive",
  });

  const connectionsQuery = useDriveConnections(workspaceId);
  const removeMutation = useRemoveTaskDriveFile(workspaceId, taskId);
  const grantMutation = useGrantDriveFileAccess(workspaceId, taskId);

  const [confirmUnlinkOpen, setConfirmUnlinkOpen] = useState(false);

  const picker = useDrivePicker({
    wsId: workspaceId,
    forTask: false,
    adapter: pickerAdapter,
    onPicked: ({ connectionId, pickedFiles }) => {
      if (pickedFiles.length === 0) return;
      void grantMutation
        .mutateAsync({
          driveFileId: card.id,
          connectionId,
        })
        .catch((err: unknown) => {
          toastApiError(err, tRoot("drive.picker.errors.link_failed"));
        });
    },
  });

  const connectPopup = useDriveConnectPopup({
    wsId: workspaceId,
    onSettled: () => {
      void connectionsQuery.refetch();
    },
  });

  const handleGrantRead = () => {
    picker.open({
      fileIds: [card.external_file_id],
      multiselect: false,
      linkOnPick: false,
    });
  };

  const handleReconnect = () => {
    const connections = connectionsQuery.data?.connections ?? [];
    const target =
      (card.viewer_connection_id
        ? connections.find((c) => c.id === card.viewer_connection_id)
        : undefined) ??
      (card.viewer_account_email
        ? connections.find((c) => c.google_email === card.viewer_account_email)
        : undefined) ??
      connections.find((c) => c.id === card.connection_id) ??
      (card.viewer_connection_id
        ? {
            id: card.viewer_connection_id,
            provider: "google",
            google_email:
              card.viewer_account_email?.trim() || card.bound_account_email.trim(),
            status: "needs_reconnect",
            needs_reconnect: true,
            auth_failed_reason: "",
            linked_file_count: 1,
            connected_at: card.linked_at,
            updated_at: card.linked_at,
          }
        : undefined);
    connectPopup.connect(target);
  };

  const handleConfirmUnlink = async () => {
    try {
      await removeMutation.mutateAsync(card.id);
      setConfirmUnlinkOpen(false);
    } catch (err) {
      toastApiError(err, tRoot("common.error"));
    }
  };

  const locale = i18n.resolvedLanguage ?? i18n.language ?? "vi";
  const metadataLine = buildMetadataLine(card, tRoot, t, locale);
  const isGranted = card.viewer_access === "granted";
  const isUnknown = card.viewer_access === "unknown";
  const isLost = card.viewer_access === "lost";
  const isConnectionLost = card.viewer_access === "connection_lost";
  const needsAttention = !isGranted;

  const tasksCreatedCount = card.tasks_created?.count ?? 0;
  const tasksCreatedDate = formatShortDate(
    card.tasks_created?.last_created_at,
    locale,
  );
  const tasksCreatedLine =
    tasksCreatedCount > 0
      ? tasksCreatedDate
        ? t("tasks_created_with_date", {
            count: tasksCreatedCount,
            date: tasksCreatedDate,
          })
        : t("tasks_created", { count: tasksCreatedCount })
      : null;

  const linkerName =
    card.created_by_name.trim() || card.bound_by_name.trim();
  const viewerEmail =
    card.viewer_account_email?.trim() || card.bound_account_email.trim();

  const grantBusy = picker.pending || grantMutation.isPending;
  const reconnectBusy = connectPopup.busy;

  const renderedActions =
    typeof actions === "function"
      ? actions({
          card,
          blocked: !isGranted,
          blockedReason: t("blocked_action_hint"),
        })
      : actions;

  return (
    <div
      data-testid={`task-drive-card-${card.id}`}
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-surface p-3.5",
        needsAttention ? "border-warning-soft-foreground/20" : "border-surface-border",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <DocumentTypeIcon
          format={card.icon_kind}
          className="size-9 shrink-0"
        />
        <div className="flex min-w-44 flex-1 flex-col gap-0.5">
          <span className="truncate text-body font-semibold text-foreground">
            {card.name}
          </span>
          <span className="truncate text-caption text-muted-foreground">
            {metadataLine}
          </span>
        </div>
        {card.bound_connection_lost && !isConnectionLost ? (
          <div className="flex basis-full items-center gap-2 pl-12 sm:basis-auto sm:pl-0">
            <Badge
              variant="outline"
              className="shrink-0 gap-1 border-warning-soft-foreground/20 bg-warning-soft text-warning-soft-foreground"
            >
              <TriangleAlert className="size-3" aria-hidden />
              {t("bound_connection_lost_badge")}
            </Badge>
          </div>
        ) : null}
      </div>

      {card.access_lost_at && !isLost ? (
        <div
          data-testid={`task-drive-card-bound-access-lost-${card.id}`}
          className="flex items-start gap-2 rounded-lg border border-warning-soft-foreground/20 bg-warning-soft px-3 py-2 text-caption text-warning-soft-foreground"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t("bound_access_lost_notice")}</span>
        </div>
      ) : null}

      {tasksCreatedLine ? (
        <div
          data-testid={`task-drive-card-tasks-created-${card.id}`}
          className="text-caption text-muted-foreground"
        >
          {tasksCreatedLine}
        </div>
      ) : null}

      {isUnknown ? (
        <div
          data-testid={`task-drive-card-unknown-${card.id}`}
          className="flex flex-col gap-2.5 rounded-lg border border-warning-soft-foreground/20 bg-warning-soft p-3 text-warning-soft-foreground"
        >
          <p className="text-caption text-pretty text-warning-soft-foreground">
            <strong className="font-semibold">{t("viewer_unknown.title")}</strong>{" "}
            {linkerName
              ? t("viewer_unknown.body", { name: linkerName })
              : t("viewer_unknown.body_unnamed")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="brand"
              size="sm"
              aria-disabled={grantBusy || undefined}
              aria-busy={grantBusy || undefined}
              onClick={() => {
                if (grantBusy) return;
                handleGrantRead();
              }}
            >
              {grantBusy ? <Spinner data-icon="inline-start" /> : null}
              {grantBusy ? t("viewer_unknown.granting") : t("viewer_unknown.grant_button")}
            </Button>
            <OpenOnDriveLink
              openUrl={card.open_url}
              label={t("open_on_drive")}
            />
            <CardMoreMenu
              canRemoveFromTask={card.can_remove_from_task}
              moreActionsAria={t("more_actions_aria", { name: card.name })}
              unlinkLabel={t("unlink")}
              onRequestUnlink={() => setConfirmUnlinkOpen(true)}
            />
          </div>
          <p className="text-caption text-warning-soft-foreground">
            {t("viewer_unknown.share_hint")}
          </p>
        </div>
      ) : null}

      {isLost ? (
        <div
          data-testid={`task-drive-card-lost-${card.id}`}
          className="flex flex-col gap-2.5 rounded-lg border border-warning-soft-foreground/20 bg-warning-soft p-3 text-warning-soft-foreground"
        >
          <div className="flex items-start gap-2 text-caption text-warning-soft-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground" aria-hidden />
            <span>
              {viewerEmail
                ? t("viewer_lost.notice", { email: viewerEmail })
                : t("viewer_lost.notice_no_email")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="brand"
              size="sm"
              aria-disabled={grantBusy || undefined}
              aria-busy={grantBusy || undefined}
              onClick={() => {
                if (grantBusy) return;
                handleGrantRead();
              }}
            >
              {grantBusy ? <Spinner data-icon="inline-start" /> : null}
              {grantBusy ? t("viewer_lost.repicking") : t("viewer_lost.repick_button")}
            </Button>
          </div>
        </div>
      ) : null}

      {isConnectionLost ? (
        <div
          data-testid={`task-drive-card-connection-lost-${card.id}`}
          className="flex flex-col gap-2.5 rounded-lg border border-warning-soft-foreground/20 bg-warning-soft p-3 text-warning-soft-foreground"
        >
          <div className="flex items-start gap-2 text-caption text-warning-soft-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-soft-foreground" aria-hidden />
            <span>
              {viewerEmail
                ? t("viewer_connection_lost.notice", { email: viewerEmail })
                : t("viewer_connection_lost.notice_no_email")}
            </span>
          </div>
          {connectPopup.notice ? (
            <Alert
              data-testid={`task-drive-card-connect-notice-${card.id}`}
              variant={
                connectPopup.notice.tone === "success"
                  ? "success"
                  : connectPopup.notice.tone === "destructive"
                    ? "destructiveSoft"
                    : "muted"
              }
              role={connectPopup.notice.tone === "destructive" ? "alert" : "status"}
            >
              <AlertDescription className="text-caption">
                {tDriveSettings(
                  driveConnectCallbackKey(
                    connectPopup.notice.code,
                    Boolean(connectPopup.notice.email),
                  ),
                  { email: connectPopup.notice.email ?? "" },
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          <DriveConsentHint />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={reconnectBusy || undefined}
              aria-busy={reconnectBusy || undefined}
              onClick={() => {
                if (reconnectBusy) return;
                if (connectPopup.popupPending) {
                  connectPopup.focusPopup();
                  return;
                }
                handleReconnect();
              }}
            >
              {reconnectBusy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden />
              )}
              {reconnectBusy
                ? t("viewer_connection_lost.reconnecting")
                : t("viewer_connection_lost.reconnect_button")}
            </Button>
          </div>
        </div>
      ) : null}

      {!isUnknown || renderedActions ? (
        <div className="flex flex-wrap items-center gap-2">
          {!isUnknown ? (
            <OpenOnDriveLink
              openUrl={card.open_url}
              label={t("open_on_drive")}
            />
          ) : null}
          {renderedActions}
          {!isUnknown ? (
            <CardMoreMenu
              canRemoveFromTask={card.can_remove_from_task}
              moreActionsAria={t("more_actions_aria", { name: card.name })}
              unlinkLabel={t("unlink")}
              onRequestUnlink={() => setConfirmUnlinkOpen(true)}
            />
          ) : null}
        </div>
      ) : null}

      {picker.dialogs}

      <ConfirmDialog
        open={confirmUnlinkOpen}
        onOpenChange={(open) => {
          if (!removeMutation.isPending) setConfirmUnlinkOpen(open);
        }}
        title={t("unlink_confirm_title")}
        description={t("unlink_confirm_description", { name: card.name })}
        confirmLabel={
          removeMutation.isPending ? t("unlinking") : t("unlink_confirm_action")
        }
        cancelLabel={t("cancel")}
        pending={removeMutation.isPending}
        destructive
        onConfirm={() => {
          void handleConfirmUnlink();
        }}
      />
    </div>
  );
}
