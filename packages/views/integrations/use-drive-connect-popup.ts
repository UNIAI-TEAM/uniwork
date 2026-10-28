"use client";

import { useCallback, useRef, useState } from "react";
import { useStartDriveConnect, type DriveConnection } from "@uniwork/core/drive";
import { useOAuthPopup, type OAuthPopupOutcome } from "./use-oauth-popup";

export const DRIVE_OAUTH_POPUP_NAME = "uniwork-drive-oauth";
export const DRIVE_OAUTH_MESSAGE_TYPE = "uniwork:drive-oauth";

export type DriveConnectCallbackNotice = {
  tone: "success" | "destructive" | "muted";
  code: string;
  email?: string;
};

/**
 * Resolves the i18n key under `settings.integrations.drive` for a Google Drive
 * OAuth popup callback code (spec §5.2, §5.7, §7.9, §7.10). Every known code
 * has its own sentence; an unrecognized code falls back to `callback.unknown`.
 */
export function driveConnectCallbackKey(code: string, hasEmail: boolean): string {
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

export interface UseDriveConnectPopupOptions {
  wsId: string;
  onSettled?: (notice: DriveConnectCallbackNotice) => void;
}

export interface UseDriveConnectPopupReturn {
  connect: (reconnect?: DriveConnection) => void;
  busy: boolean;
  popupPending: boolean;
  focusPopup: () => void;
  notice: DriveConnectCallbackNotice | null;
  clearNotice: () => void;
}

/**
 * Shared W1 Google Drive OAuth popup controller (UNI-2186 / UNI-2187 R1-4).
 *
 * Starts `POST /workspaces/{ws}/drive-connections/google/start` (passing
 * `reconnect_connection_id` when reconnecting a lost account), opens the
 * popup synchronously on `about:blank` via `useOAuthPopup`, listens for
 * `uniwork:drive-oauth`, and maps the outcome into a `DriveConnectCallbackNotice`
 * so the Picker (and Settings) can run connect / reconnect in place without
 * leaving the host dialog.
 */
export function useDriveConnectPopup({
  wsId,
  onSettled,
}: UseDriveConnectPopupOptions): UseDriveConnectPopupReturn {
  const startConnect = useStartDriveConnect(wsId);
  const reconnectTargetRef = useRef<DriveConnection | null>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const [notice, setNotice] = useState<DriveConnectCallbackNotice | null>(null);

  const onPopupOutcome = useCallback((outcome: OAuthPopupOutcome) => {
    const targetEmail = reconnectTargetRef.current?.google_email;
    reconnectTargetRef.current = null;

    let nextNotice: DriveConnectCallbackNotice;
    switch (outcome.kind) {
      case "message": {
        if (outcome.ok || outcome.code === "connected" || outcome.code === "reconnected") {
          nextNotice = {
            tone: "success",
            code: outcome.code === "reconnected" ? "reconnected" : "connected",
            email: targetEmail,
          };
        } else {
          nextNotice = {
            tone: "destructive",
            code: outcome.code,
            email: targetEmail,
          };
        }
        break;
      }
      case "blocked":
        nextNotice = { tone: "destructive", code: "popup_blocked" };
        break;
      case "closed":
        nextNotice = { tone: "muted", code: "oauth_closed" };
        break;
      case "failed":
        nextNotice = { tone: "destructive", code: "unknown" };
        break;
    }

    setNotice(nextNotice);
    onSettledRef.current?.(nextNotice);
  }, []);

  const popup = useOAuthPopup({
    name: DRIVE_OAUTH_POPUP_NAME,
    messageType: DRIVE_OAUTH_MESSAGE_TYPE,
    onOutcome: onPopupOutcome,
  });

  const connect = useCallback(
    (reconnect?: DriveConnection) => {
      setNotice(null);
      reconnectTargetRef.current = reconnect ?? null;
      popup.open(() =>
        startConnect.mutateAsync(
          reconnect ? { reconnect_connection_id: reconnect.id } : undefined,
        ),
      );
    },
    [popup, startConnect],
  );

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  return {
    connect,
    busy: popup.pending || startConnect.isPending,
    popupPending: popup.pending,
    focusPopup: popup.focus,
    notice,
    clearNotice,
  };
}
