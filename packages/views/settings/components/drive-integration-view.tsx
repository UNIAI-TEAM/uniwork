"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Plug, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  isDriveConnectionLost,
  useDisconnectDriveConnection,
  useDriveConnections,
  useStartDriveConnect,
  type DriveConnection,
} from "@uniwork/core/drive";
import { Button } from "@uniwork/ui/components/ui/button";
import { ConfirmDialog } from "../../common/form-dialog";
import { useOAuthPopup, type OAuthPopupOutcome } from "../../integrations/use-oauth-popup";
import { useWorkspace } from "../../layout/workspace-context";
import { toastApiError } from "../../toast-api-error";
import {
  DRIVE_OAUTH_MESSAGE,
  DriveCallbackAlert,
  DriveMarkTile,
  useDriveAvailable,
  type CallbackNotice,
} from "./drive-integration-row";
import {
  SettingsBadge,
  SettingsCard,
  SettingsEmpty,
  SettingsLoadError,
  SettingsSection,
  SettingsSkeletonRows,
  SettingsTab,
} from "./settings-layout";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

/**
 * Formats an ISO timestamp with the date before the time in every locale
 * (in Vietnamese `Intl.DateTimeFormat` with `dateStyle` + `timeStyle` puts
 * the time first, which reads awkwardly after "Kết nối").
 */
function formatDriveConnectedAt(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const datePart = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
  const timePart = new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(d);
  return `${datePart}, ${timePart}`;
}

/**
 * The "UNI được làm gì với tài liệu đã liên kết" block and the three scope /
 * count / storage summary tiles from prototype 1.3 (`Connected.dc.html`).
 */
function DrivePermissionsSummary({ totalLinkedFiles }: { totalLinkedFiles: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.integrations.drive" });
  return (
    <div className="space-y-4 rounded-xl border border-surface-border bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
          <div className="text-caption text-muted-foreground">{t("scope_label")}</div>
          <div className="mt-0.5 text-body font-medium text-foreground">{t("scope_value")}</div>
        </div>
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
          <div className="text-caption text-muted-foreground">{t("linked_count_label")}</div>
          <div className="mt-0.5 text-body font-medium text-foreground">
            {t("linked_count", { count: totalLinkedFiles })}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5">
          <div className="text-caption text-muted-foreground">{t("storage_label")}</div>
          <div className="mt-0.5 text-body font-medium text-foreground">{t("storage_value")}</div>
        </div>
      </div>

      <div className="space-y-2 text-body text-foreground">
        <div className="font-semibold">{t("uni_permissions.title")}</div>
        <ul className="space-y-1.5 text-caption text-muted-foreground">
          <li className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
            <span>{t("uni_permissions.read")}</span>
          </li>
          <li className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
            <span>{t("uni_permissions.propose")}</span>
          </li>
          <li className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
            <span>{t("uni_permissions.confirm_only")}</span>
          </li>
          <li className="flex items-start gap-2">
            <X aria-hidden className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span>{t("uni_permissions.never")}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function DriveAccountCard({
  connection,
  formattedDate,
  busy,
  onReconnect,
  onDisconnect,
}: {
  connection: DriveConnection;
  formattedDate: string;
  busy: boolean;
  onReconnect: (connection: DriveConnection) => void;
  onDisconnect: (connection: DriveConnection) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.integrations.drive" });
  const lost = isDriveConnectionLost(connection);
  const metaParts = [
    formattedDate ? t("account.connected_at", { when: formattedDate }) : null,
    t("linked_count", { count: connection.linked_file_count }),
  ].filter(Boolean);

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border border-surface-border bg-surface px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <DriveMarkTile />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              title={connection.google_email}
              className="min-w-0 truncate text-body font-medium text-foreground"
            >
              {connection.google_email}
            </span>
            {lost ? (
              <SettingsBadge tone="warning" icon={<TriangleAlert aria-hidden />}>
                {t("account.lost_reconnect")}
              </SettingsBadge>
            ) : (
              <SettingsBadge tone="success">{t("account.status_active")}</SettingsBadge>
            )}
          </div>
          <div className="text-caption text-muted-foreground">{metaParts.join(" · ")}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
        {lost ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={busy || undefined}
            aria-label={t("account.reconnect_aria", { email: connection.google_email })}
            onClick={() => {
              if (!busy) onReconnect(connection);
            }}
          >
            <RefreshCw aria-hidden className="size-3.5" />
            {t("account.reconnect")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          aria-disabled={busy || undefined}
          aria-label={t("account.disconnect_aria", { email: connection.google_email })}
          onClick={() => {
            if (!busy) onDisconnect(connection);
          }}
        >
          {t("account.disconnect")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Dedicated Google Drive sub-view inside Settings › Integrations
 * (`?tab=integrations&integration=drive`, prototype 1.3 `Connected.dc.html`).
 */
export function DriveIntegrationView({
  initialNotice = null,
  onBack,
}: {
  initialNotice?: CallbackNotice | null;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.integrations.drive" });
  const { t: tSettings } = useTranslation(undefined, { keyPrefix: "settings" });
  const { workspace } = useWorkspace();
  const driveAvailable = useDriveAvailable();
  const connectionsQuery = useDriveConnections(workspace.id, { enabled: driveAvailable });
  const startConnect = useStartDriveConnect(workspace.id);
  const disconnect = useDisconnectDriveConnection(workspace.id);

  const reconnectTargetRef = useRef<DriveConnection | null>(null);
  const lastDisconnectEmailRef = useRef("");
  const [notice, setNotice] = useState<CallbackNotice | null>(initialNotice);
  const [pendingDisconnect, setPendingDisconnect] = useState<DriveConnection | null>(null);

  useEffect(() => {
    if (initialNotice) {
      setNotice(initialNotice);
    }
  }, [initialNotice]);

  const onPopupOutcome = (outcome: OAuthPopupOutcome) => {
    const targetEmail = reconnectTargetRef.current?.google_email;
    reconnectTargetRef.current = null;

    switch (outcome.kind) {
      case "message": {
        if (outcome.ok || outcome.code === "connected" || outcome.code === "reconnected") {
          setNotice({
            tone: "success",
            code: outcome.code === "reconnected" ? "reconnected" : "connected",
          });
          void connectionsQuery.refetch();
          return;
        }
        setNotice({
          tone: "destructive",
          code: outcome.code,
          email: targetEmail,
        });
        void connectionsQuery.refetch();
        return;
      }
      case "blocked":
        setNotice({ tone: "destructive", code: "popup_blocked" });
        return;
      case "closed":
        setNotice({ tone: "muted", code: "oauth_closed" });
        void connectionsQuery.refetch();
        return;
      case "failed":
        setNotice({ tone: "destructive", code: "unknown" });
        return;
    }
  };

  const popup = useOAuthPopup({
    name: "uniwork-drive-oauth",
    messageType: DRIVE_OAUTH_MESSAGE,
    onOutcome: onPopupOutcome,
  });

  if (!driveAvailable) return null;

  const connections = connectionsQuery.data?.connections ?? [];
  const totalLinkedFiles = connections.reduce((sum, c) => sum + c.linked_file_count, 0);
  const busy = popup.pending || startConnect.isPending;

  const handleConnect = (reconnect?: DriveConnection) => {
    setNotice(null);
    reconnectTargetRef.current = reconnect ?? null;
    popup.open(() =>
      startConnect.mutateAsync(
        reconnect ? { reconnect_connection_id: reconnect.id } : undefined,
      ),
    );
  };

  return (
    <div className="space-y-6" data-testid="drive-integration-view">
      <nav
        aria-label={tSettings("page.tabs.integrations")}
        className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground"
      >
        <span>{tSettings("page.title")}</span>
        <ChevronRight aria-hidden className="size-3 shrink-0 text-faint-foreground" />
        <button
          type="button"
          onClick={onBack}
          className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {tSettings("page.tabs.integrations")}
        </button>
        <ChevronRight aria-hidden className="size-3 shrink-0 text-faint-foreground" />
        <span aria-current="page" className="font-medium text-foreground">
          {t("title")}
        </span>
      </nav>

      <SettingsTab
        title={t("title")}
        description={t("meta")}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) handleConnect();
            }}
          >
            <Plus aria-hidden className="size-4" />
            {t("add_account")}
          </Button>
        }
      >
        <div className="space-y-6">
          {notice ? <DriveCallbackAlert notice={notice} /> : null}

          {popup.pending ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
              <span role="status" className="inline-flex items-center gap-2">
                <Spinner />
                {t("oauth_pending")}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={popup.focus}
              >
                {t("oauth_show_window")}
              </Button>
            </div>
          ) : null}

          <SettingsSection title={t("view.accounts_title")}>
            {connectionsQuery.isLoading ? (
              <SettingsSkeletonRows rows={2} />
            ) : connectionsQuery.isError ? (
              <SettingsCard>
                <SettingsLoadError onRetry={() => void connectionsQuery.refetch()}>
                  {t("load_error")}
                </SettingsLoadError>
              </SettingsCard>
            ) : connections.length === 0 ? (
              <SettingsCard>
                <SettingsEmpty icon={<Plug aria-hidden />}>{t("view.empty")}</SettingsEmpty>
              </SettingsCard>
            ) : (
              <div className="space-y-2.5">
                {connections.map((conn) => (
                  <DriveAccountCard
                    key={conn.id}
                    connection={conn}
                    formattedDate={formatDriveConnectedAt(conn.connected_at, i18n.language)}
                    busy={busy || disconnect.isPending}
                    onReconnect={(target) => handleConnect(target)}
                    onDisconnect={(target) => {
                      lastDisconnectEmailRef.current = target.google_email;
                      setPendingDisconnect(target);
                    }}
                  />
                ))}
              </div>
            )}
          </SettingsSection>

          <DrivePermissionsSummary totalLinkedFiles={totalLinkedFiles} />
        </div>
      </SettingsTab>

      <ConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null);
        }}
        title={t("disconnect_dialog.title", {
          email: pendingDisconnect?.google_email ?? lastDisconnectEmailRef.current,
        })}
        description={t("disconnect_dialog.description")}
        confirmLabel={t("disconnect_dialog.confirm")}
        cancelLabel={t("disconnect_dialog.cancel")}
        pending={disconnect.isPending}
        onConfirm={() => {
          if (!pendingDisconnect) return;
          const target = pendingDisconnect;
          disconnect.mutate(target.id, {
            onSuccess: () => {
              setPendingDisconnect(null);
              setNotice(null);
              toast.success(t("disconnect_dialog.success", { email: target.google_email }));
            },
            onError: (err) => toastApiError(err, t("disconnect_dialog.error")),
          });
        }}
      />
    </div>
  );
}
