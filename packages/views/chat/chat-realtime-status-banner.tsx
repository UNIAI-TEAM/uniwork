"use client";

import { useTranslation } from "react-i18next";
import { useWSConnectionState } from "@uniwork/core/realtime";
import { Button } from "@uniwork/ui/components/ui/button";

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

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2"
      role="status"
    >
      <div className="space-y-1">
        {showReconnectBanner ? (
          <p className="text-caption text-muted-foreground">
            {state === "connecting"
              ? t("chat.ws_reconnecting")
              : t("chat.ws_disconnected")}
          </p>
        ) : null}
        {pendingOutboxCount > 0 ? (
          <p className="text-caption text-muted-foreground">
            {t("chat.send_outbox_pending", { count: pendingOutboxCount })}
          </p>
        ) : null}
      </div>
      {state === "disconnected" ? (
        <Button type="button" variant="outline" size="sm" onClick={() => reconnectNow()}>
          {t("chat.retry")}
        </Button>
      ) : null}
    </div>
  );
}
