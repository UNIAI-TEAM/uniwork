"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  isDriveConnectionLost,
  useDisconnectDriveConnection,
  useDriveConnections,
  useStartDriveConnect,
  type DriveConnection,
} from "@uniwork/core/drive";
import { EMPTY_CONFIG, useFlag, usePublicConfig } from "@uniwork/core/feature-flags";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { ConfirmDialog } from "../../common/form-dialog";
import { GoogleDriveMark } from "../../common/provider-icons";
import { useOAuthPopup, type OAuthPopupOutcome } from "../../integrations/use-oauth-popup";
import { useWorkspace } from "../../layout/workspace-context";
import { useNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import {
  SettingsBadge,
  SettingsListItem,
} from "./settings-layout";

const DRIVE_CONNECTOR_FLAG = "drive_connector";
const DRIVE_OAUTH_MESSAGE = "uniwork:drive-oauth";

type CallbackNotice = {
  tone: "success" | "destructive" | "muted";
  code: string;
  email?: string;
};

/**
 * Resolves the i18n key under `settings.integrations.drive` for a popup
 * callback code (spec §5.2, §5.7, §7.9, §7.10). Every known code has its own
 * sentence; an unrecognized code falls back to `callback.unknown`.
 */
function driveCallbackKey(code: string, hasEmail: boolean): string {
  switch (code) {
    case "connected":
      return "callback.connected";
    case "reconnected":
      return "callback.reconnected";
    case "consent_required":
      return "callback.consent_required";
    case "scope_not_granted":
      return "callback.scope_not_granted";
    case "account_mismatch":
      return hasEmail ? "callback.account_mismatch" : "callback.account_mismatch_generic";
    case "state_invalid":
      return "callback.state_invalid";
    case "retry_connect":
      return "callback.retry_connect";
    case "blocked_by_workspace_admin":
      return "callback.blocked_by_workspace_admin";
    case "access_denied":
      return "callback.access_denied";
    case "provider_error":
      return "callback.provider_error";
    case "popup_blocked":
      return "popup_blocked";
    case "oauth_closed":
      return "oauth_closed";
    default:
      return "callback.unknown";
  }
}

function DriveMarkTile() {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-tint-blue">
      <GoogleDriveMark className="size-4" />
    </span>
  );
}

/**
 * The "UNI được làm gì với tài liệu đã liên kết" block and the three scope /
 * count / storage summary tiles from prototype 1.3 (`Connected.dc.html`).
 */
function DrivePermissionsSummary({ totalLinkedFiles }: { totalLinkedFiles: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.integrations.drive" });
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-caption text-muted-foreground">{t("scope_label")}</div>
          <div className="mt-0.5 text-body font-medium text-foreground">{t("scope_value")}</div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-caption text-muted-foreground">{t("linked_count_label")}</div>
          <div className="mt-0.5 text-body font-medium text-foreground">
            {t("linked_count", { count: totalLinkedFiles })}
          </div>
        </div>
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-caption text-muted-foreground">{t("storage_label")}</div>
          <div className="mt-0.5 text-body font-medium text-foreground">{t("storage_value")}</div>
        </div>
      </div>

      <div className="space-y-1.5 text-caption text-foreground">
        <div className="font-semibold">{t("uni_permissions.title")}</div>
        <ul className="space-y-1 text-muted-foreground">
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-body font-medium text-foreground">
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

      <div className="flex shrink-0 items-center gap-2">
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
 * Google Drive row inside Settings › Integrations (spec §5.2, §5.3, §5.7,
 * §7.9, §7.10, §7.11; prototypes 1.1 `Main.dc.html` and 1.3 `Connected.dc.html`).
 *
 * Rendered only when both the `drive_connector` feature flag and
 * `drive.available` from `GET /api/v1/config` are true.
 */
export function DriveIntegrationRow() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.integrations.drive" });
  const { workspace } = useWorkspace();
  const navigation = useNavigation();
  const flagEnabled = useFlag(DRIVE_CONNECTOR_FLAG, false);
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const driveAvailable = flagEnabled && Boolean(config.drive?.available);
  const connectionsQuery = useDriveConnections(workspace.id, { enabled: driveAvailable });
  const startConnect = useStartDriveConnect(workspace.id);
  const disconnect = useDisconnectDriveConnection(workspace.id);

  const rowRef = useRef<HTMLDivElement>(null);
  const reconnectTargetRef = useRef<DriveConnection | null>(null);
  const lastDisconnectEmailRef = useRef("");
  const [notice, setNotice] = useState<CallbackNotice | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<DriveConnection | null>(null);
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

  // Handoff param `?connect=drive` (spec §7.11): scrolls + focuses the Drive
  // row, removes `connect` with `replace`, and never opens the popup or calls
  // the start API.
  const connectParam = navigation.searchParams.get("connect");
  const focusPendingRef = useRef(connectParam === "drive");
  useEffect(() => {
    if (connectParam === "drive") {
      focusPendingRef.current = true;
    }
    if (!driveAvailable) return;
    if (connectParam === "drive" || focusPendingRef.current) {
      focusPendingRef.current = false;
      rowRef.current?.scrollIntoView?.({ block: "nearest" });
      rowRef.current?.focus();
    }
    if (connectParam === "drive") {
      const nextParams = new URLSearchParams(navigation.searchParams);
      nextParams.delete("connect");
      if (!nextParams.get("tab")) {
        nextParams.set("tab", "integrations");
      }
      const qs = nextParams.toString();
      navigation.replace(qs ? `${navigation.pathname}?${qs}` : navigation.pathname);
    }
  }, [connectParam, driveAvailable, navigation]);
  if (!driveAvailable) return null;

  const connections = connectionsQuery.data?.connections ?? [];
  const count = connections.length;
  const brokenCount = connections.filter((c) => isDriveConnectionLost(c)).length;
  const totalLinkedFiles = connections.reduce((sum, c) => sum + c.linked_file_count, 0);
  const busy = popup.pending || startConnect.isPending;

  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const formatConnectedAt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : dateFormat.format(d);
  };

  const handleConnect = (reconnect?: DriveConnection) => {
    setNotice(null);
    reconnectTargetRef.current = reconnect ?? null;
    popup.open(() =>
      startConnect.mutateAsync(
        reconnect ? { reconnect_connection_id: reconnect.id } : undefined,
      ),
    );
  };

  // Until the list arrives (or when it fails) nothing is known about the
  // reader's connections, so neither the badge nor the action claims "none".
  const badge = connectionsQuery.isLoading ? (
    <Skeleton className="h-5 w-24" />
  ) : connectionsQuery.isError ? (
    <SettingsBadge tone="destructive">{t("load_error")}</SettingsBadge>
  ) : count > 0 ? (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <SettingsBadge tone={brokenCount > 0 ? "warning" : "success"}>
        {t("connected", { count })}
        {brokenCount > 0 ? t("needs_reconnect", { count: brokenCount }) : null}
      </SettingsBadge>
    </span>
  ) : (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <SettingsBadge tone="muted">{t("not_connected")}</SettingsBadge>
      <SettingsBadge tone="brand">{t("new_badge")}</SettingsBadge>
    </span>
  );

  const actions = connectionsQuery.isLoading ? null : connectionsQuery.isError ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void connectionsQuery.refetch()}
    >
      <RefreshCw aria-hidden className="size-3.5" />
      {t("retry")}
    </Button>
  ) : count > 0 ? (
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
  ) : (
    <Button
      type="button"
      size="sm"
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) handleConnect();
      }}
    >
      {busy ? t("connecting") : t("connect")}
    </Button>
  );
  return (
    <SettingsListItem
      leading={<DriveMarkTile />}
      title={
        <div
          ref={rowRef}
          tabIndex={-1}
          data-testid="drive-integration-row"
          className="inline-flex items-center gap-2 rounded-sm"
        >
          <span>{t("title")}</span>
        </div>
      }
      badge={badge}
      actions={actions}
      meta={
        <div className="mt-1 space-y-3 whitespace-normal">
          <p className="text-caption text-pretty text-muted-foreground">{t("meta")}</p>
          <p className="text-caption text-pretty text-muted-foreground">{t("consent_note")}</p>

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

          {notice ? (
            <Alert
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
                {t(driveCallbackKey(notice.code, Boolean(notice.email)), {
                  email: notice.email ?? "",
                })}
              </AlertDescription>
            </Alert>
          ) : null}

          {count > 0 ? (
            <div className="space-y-3 pt-1">
              <div className="space-y-2">
                {connections.map((conn) => (
                  <DriveAccountCard
                    key={conn.id}
                    connection={conn}
                    formattedDate={formatConnectedAt(conn.connected_at)}
                    busy={busy || disconnect.isPending}
                    onReconnect={(target) => handleConnect(target)}
                    onDisconnect={(target) => {
                      lastDisconnectEmailRef.current = target.google_email;
                      setPendingDisconnect(target);
                    }}
                  />
                ))}
              </div>
              <DrivePermissionsSummary totalLinkedFiles={totalLinkedFiles} />
            </div>
          ) : null}

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
      }
    />
  );
}
