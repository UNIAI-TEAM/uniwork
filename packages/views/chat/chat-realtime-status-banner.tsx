"use client";

import { Clock, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWSConnectionState } from "@uniwork/core/realtime";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import { CHAT_NOTICE_STRIP, ChatNoticeRetryButton } from "./chat-notice";

/** A socket that drops and returns within this window is not worth a sentence. */
export const REALTIME_ANNOUNCE_DELAY_MS = 2000;

/**
 * Connection and outbox state for the open conversation. The strip is visual
 * only; what a screen reader hears goes through one status region that stays
 * mounted with the frame, so the change of its text is what gets announced
 * (a region mounted together with its text often is not). The connection line
 * is announced only after it has held for two seconds, so a flapping socket
 * does not read "reconnecting" on every blip.
 */
export function ChatRealtimeStatusBanner({
  pendingOutboxCount = 0,
}: {
  pendingOutboxCount?: number;
}) {
  const { t } = useTranslation();
  const { state, hasEverConnected, reconnectNow } = useWSConnectionState();

  const showReconnectBanner =
    state === "disconnected" || (state === "connecting" && hasEverConnected);
  const disconnected = state === "disconnected";
  const reconnecting = showReconnectBanner && state === "connecting";
  const connectionLine = showReconnectBanner
    ? state === "connecting"
      ? t("chat.ws_reconnecting")
      : t("chat.ws_disconnected")
    : "";
  const outboxLine = pendingOutboxCount > 0 ? t("chat.send_outbox_pending", { count: pendingOutboxCount }) : "";

  const [announcedConnection, setAnnouncedConnection] = useState("");
  useEffect(() => {
    if (!connectionLine) {
      setAnnouncedConnection("");
      return;
    }
    const timer = setTimeout(() => setAnnouncedConnection(connectionLine), REALTIME_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [connectionLine]);

  const announcement = [announcedConnection, outboxLine].filter(Boolean).join(". ");

  return (
    <>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {showReconnectBanner || outboxLine ? (
        <Notice
          tone={disconnected ? "warning" : "info"}
          icon={disconnected ? WifiOff : reconnecting ? RefreshCw : Clock}
          live="off"
          // The reconnecting arrows turn while the socket retries; still under reduced motion.
          className={cn(CHAT_NOTICE_STRIP, reconnecting && "[&>svg]:motion-safe:animate-spin")}
          action={disconnected ? <ChatNoticeRetryButton onClick={() => reconnectNow()} /> : null}
        >
          {connectionLine ? (
            <p className={cn("text-body", disconnected ? "font-semibold" : "font-medium")}>{connectionLine}</p>
          ) : null}
          {outboxLine ? (
            <p className={cn("tabular-nums", connectionLine ? "text-label font-normal" : "text-body font-medium")}>
              {outboxLine}
            </p>
          ) : null}
        </Notice>
      ) : null}
    </>
  );
}
