"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWSConnectionState } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";

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
          icon={disconnected ? CloudOff : RefreshCw}
          live="off"
          action={
            disconnected ? (
              <Button type="button" variant="outline" size="sm" onClick={() => reconnectNow()}>
                {t("chat.retry")}
              </Button>
            ) : null
          }
        >
          {connectionLine ? <p>{connectionLine}</p> : null}
          {outboxLine ? <p>{outboxLine}</p> : null}
        </Notice>
      ) : null}
    </>
  );
}
