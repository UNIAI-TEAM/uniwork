"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  isDriveConnectionLost,
  useDriveConnections,
  useStartDriveConnect,
} from "@uniwork/core/drive";
import { EMPTY_CONFIG, useFlag, usePublicConfig } from "@uniwork/core/feature-flags";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { GoogleDriveMark } from "../../common/provider-icons";
import { useOAuthPopup, type OAuthPopupOutcome } from "../../integrations/use-oauth-popup";
import { useWorkspace } from "../../layout/workspace-context";
import { SettingsBadge, SettingsListItem } from "./settings-layout";

export const DRIVE_CONNECTOR_FLAG = "drive_connector";
export const DRIVE_OAUTH_MESSAGE = "uniwork:drive-oauth";

/**
 * Single availability rule for the Google Drive connector across Settings,
 * Tasks, and Documents: both the `drive_connector` feature flag and
 * `drive.available` from `GET /api/v1/config` must be true.
 */
export function useDriveAvailable(): boolean {
  const flagEnabled = useFlag(DRIVE_CONNECTOR_FLAG, false);
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  return flagEnabled && Boolean(config.drive?.available);
}

export type CallbackNotice = {
  tone: "success" | "destructive" | "muted";
  code: string;
  email?: string;
};

/**
 * Resolves the i18n key under `settings.integrations.drive` for a popup
 * callback code (spec §5.2, §5.7, §7.9, §7.10). Every known code has its own
 * sentence; an unrecognized code falls back to `callback.unknown`.
 */
export function driveCallbackKey(code: string, hasEmail: boolean): string {
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

export function DriveMarkTile() {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-tint-blue">
      <GoogleDriveMark className="size-4" />
    </span>
  );
}

export function DriveCallbackAlert({ notice }: { notice: CallbackNotice }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.integrations.drive" });
  return (
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
  );
}

/**
 * Compact Google Drive row inside Settings › Integrations (spec §5.2, §7.9,
 * §7.10, §7.11; prototype 1.1 `Main.dc.html`).
 *
 * Rendered only when both the `drive_connector` feature flag and
 * `drive.available` from `GET /api/v1/config` are true. When ≥1 account is
 * connected (or after a successful first connect), "Quản lý" opens the
 * dedicated Google Drive sub-view (1.3 `Connected.dc.html`).
 */
export function DriveIntegrationRow({
  focusDriveRow = false,
  onDriveRowFocused,
  focusManageButton = false,
  onManageButtonFocused,
  onOpenDriveView,
}: {
  focusDriveRow?: boolean;
  onDriveRowFocused?: () => void;
  focusManageButton?: boolean;
  onManageButtonFocused?: () => void;
  onOpenDriveView: (initialNotice?: CallbackNotice) => void;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.integrations.drive" });
  const { workspace } = useWorkspace();
  const driveAvailable = useDriveAvailable();
  const connectionsQuery = useDriveConnections(workspace.id, { enabled: driveAvailable });
  const startConnect = useStartDriveConnect(workspace.id);

  const rowRef = useRef<HTMLLIElement>(null);
  const manageBtnRef = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState<CallbackNotice | null>(null);

  const onPopupOutcome = (outcome: OAuthPopupOutcome) => {
    switch (outcome.kind) {
      case "message": {
        if (outcome.ok || outcome.code === "connected" || outcome.code === "reconnected") {
          const successNotice: CallbackNotice = {
            tone: "success",
            code: outcome.code === "reconnected" ? "reconnected" : "connected",
          };
          void connectionsQuery.refetch();
          onOpenDriveView(successNotice);
          return;
        }
        setNotice({
          tone: "destructive",
          code: outcome.code,
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

  // Handoff param `?connect=drive` (spec §7.11): `SettingsPage` strips `connect`
  // on mount and passes `focusDriveRow` down so the row still scrolls + focuses
  // even when its lazy chunk or config query settles after the URL replace.
  useEffect(() => {
    if (!driveAvailable || !focusDriveRow) return;
    rowRef.current?.scrollIntoView?.({ block: "nearest" });
    rowRef.current?.focus();
    onDriveRowFocused?.();
  }, [driveAvailable, focusDriveRow, onDriveRowFocused]);

  const connections = connectionsQuery.data?.connections ?? [];
  const count = connections.length;

  useEffect(() => {
    if (!driveAvailable || !focusManageButton || connectionsQuery.isLoading) return;
    if (manageBtnRef.current) {
      manageBtnRef.current.focus();
    } else {
      rowRef.current?.focus();
    }
    onManageButtonFocused?.();
  }, [driveAvailable, focusManageButton, connectionsQuery.isLoading, count, onManageButtonFocused]);

  if (!driveAvailable) return null;

  const brokenCount = connections.filter((c) => isDriveConnectionLost(c)).length;
  const busy = popup.pending || startConnect.isPending;

  const handleConnect = () => {
    setNotice(null);
    popup.open(() => startConnect.mutateAsync(undefined));
  };

  // Until the list arrives (or when it fails) nothing is known about the
  // reader's connections, so neither the badge nor the action claims "none".
  const badge = connectionsQuery.isLoading ? (
    <Skeleton className="h-5 w-24" />
  ) : connectionsQuery.isError ? (
    <SettingsBadge tone="destructive">{t("load_error")}</SettingsBadge>
  ) : count > 0 ? (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <SettingsBadge
        tone={brokenCount > 0 ? "warning" : "success"}
        icon={brokenCount > 0 ? <TriangleAlert aria-hidden /> : undefined}
      >
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

  const actions = connectionsQuery.isLoading ? (
    <Skeleton aria-hidden className="h-8 w-36 rounded-control" />
  ) : connectionsQuery.isError ? (
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
      ref={manageBtnRef}
      type="button"
      variant="outline"
      size="sm"
      onClick={() => onOpenDriveView()}
    >
      {t("manage")}
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
      rowRef={rowRef}
      tabIndex={-1}
      data-testid="drive-integration-row"
      align="start"
      wrapTitle
      className="rounded-sm first:rounded-t-lg last:rounded-b-lg focus-visible:-outline-offset-2"
      leading={<DriveMarkTile />}
      title={t("title")}
      badge={badge}
      actions={actions}
      meta={
        <div className="mt-0.5 space-y-2 whitespace-normal">
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
                className="h-auto px-0 focus-visible:-outline-offset-2"
                onClick={popup.focus}
              >
                {t("oauth_show_window")}
              </Button>
            </div>
          ) : null}

          <p className="text-caption text-pretty text-muted-foreground">{t("meta")}</p>
        </div>
      }
    />
  );
}
