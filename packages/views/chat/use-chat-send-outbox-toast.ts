"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useChatSendOutboxFlush } from "@uniwork/core/chat";

/**
 * Drains the persisted send outbox and toasts the sends the server refused for
 * good. A toast, not the page's connect error: that line is hidden on the
 * workspace room, where the page lands and where the mount-time flush runs.
 */
export function useChatSendOutboxToast(workspaceId: string, currentUserId: string): void {
  const { t } = useTranslation();
  const onDropped = useCallback(
    (count: number) => {
      toast.error(t("chat.send_outbox_dropped", { count }));
    },
    [t],
  );
  useChatSendOutboxFlush(workspaceId, currentUserId, onDropped);
}
