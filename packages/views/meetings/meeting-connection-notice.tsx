"use client";

import { useState } from "react";
import { useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { RefreshCw, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Notice } from "../common/notice";

type ConnectionNoticeKind = "reconnecting" | "lost";

/**
 * What the stage should say about the room connection. Nothing until the
 * room has connected once: the first "connecting" is joining, not a loss.
 */
export function connectionNotice(
  state: ConnectionState,
  wasConnected: boolean,
): ConnectionNoticeKind | null {
  if (!wasConnected) return null;
  switch (state) {
    case ConnectionState.Connected:
      return null;
    case ConnectionState.Disconnected:
      return "lost";
    default:
      return "reconnecting";
  }
}

/**
 * In-stage strip for a shaky connection. A dropped room is taken over by the
 * room's own error screen (room-view), which owns the retry; this strip covers
 * the seconds before that and the automatic reconnects LiveKit runs itself.
 */
export function MeetingConnectionNotice() {
  const { t } = useTranslation();
  const state = useConnectionState();
  const [wasConnected, setWasConnected] = useState(false);
  if (state === ConnectionState.Connected && !wasConnected) setWasConnected(true);
  const kind = connectionNotice(state, wasConnected);
  if (!kind) return null;
  return kind === "lost" ? (
    <Notice tone="destructive" icon={WifiOff} live="assertive" layout="inline" className="mb-2 shrink-0">
      {t("meetings.connectionLost")}
    </Notice>
  ) : (
    <Notice tone="warning" icon={RefreshCw} layout="inline" className="mb-2 shrink-0">
      {t("meetings.connectionReconnecting")}
    </Notice>
  );
}
