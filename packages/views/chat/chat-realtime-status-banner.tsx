"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWSConnectionState } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";
import { ChatNotice } from "./chat-notice";

export function ChatRealtimeStatusBanner({
  pendingOutboxCount = 0,
}: {
  pendingOutboxCount?: number;
}) {
  const { t } = useTranslation();
  const { state, hasEverConnected, reconnectNow } = useWSConnectionState();

  const showReconnectBanner =
    state === "disconnected" || (state === "connecting" && hasEverConnected);

  if (!showReconnectBanner && pendingOutboxCount <= 0) {
    return null;
  }

  const disconnected = state === "disconnected";
  return (
    <ChatNotice
      tone={disconnected ? "warning" : "info"}
      icon={disconnected ? CloudOff : RefreshCw}
      action={
        disconnected ? (
          <Button type="button" variant="outline" size="sm" onClick={() => reconnectNow()}>
            {t("chat.retry")}
          </Button>
        ) : null
      }
    >
      {showReconnectBanner ? (
        <p>{state === "connecting" ? t("chat.ws_reconnecting") : t("chat.ws_disconnected")}</p>
      ) : null}
      {pendingOutboxCount > 0 ? (
        <p>{t("chat.send_outbox_pending", { count: pendingOutboxCount })}</p>
      ) : null}
    </ChatNotice>
  );
}
