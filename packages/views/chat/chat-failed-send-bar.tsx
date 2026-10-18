"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useRetryChatSend } from "@uniwork/core/chat";
import { useChatSendOutboxStore } from "@uniwork/core/chat/send-outbox-store";
import { isChatSendRateLimited } from "@uniwork/core/chat/send-retry";
import { Button } from "@uniwork/ui/components/ui/button";
import { toastChatError } from "./chat-error-message";
import type { ChatMessage } from "./chat-messages";

/**
 * "Chưa gửi được · Thử lại · Bỏ tin này" under a send that reached the server
 * and failed. A pill on the wall (canvas), because the destructive ink does
 * not read on my brand bubble. "Thử lại" sends the same client_msg_id again;
 * the bubble then reads "Đang gửi…" and the pill leaves until the answer.
 */
export function ChatFailedSendBar({ workspaceId, message }: { workspaceId: string; message: ChatMessage }) {
  const { t } = useTranslation();
  const retry = useRetryChatSend(workspaceId);
  const clientMsgId = message.clientMsgId;
  if (!clientMsgId) return null;

  const onRetry = async () => {
    const result = await retry(clientMsgId);
    // The bubble shows what is left; a toast only says what it cannot: why a
    // send went away for good, or that the server wants the sender to slow down.
    if (result?.outcome === "dropped") toastChatError(result.error, t, t("chat.send_failed"));
    else if (result?.outcome === "failed" && isChatSendRateLimited(result.error)) {
      toast.error(t("chat.send_rate_limited"));
    }
  };

  return (
    <div
      role="alert"
      className="mt-0.5 inline-flex min-h-7.5 w-fit items-center gap-1.5 self-end rounded-full bg-chat-chip py-0.5 pr-1 pl-2.5 text-label font-semibold text-destructive"
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span>{t("chat.message_failed")}</span>
      <span aria-hidden>·</span>
      <Button
        type="button"
        variant="destructive"
        size="xs"
        className="h-6 rounded-full px-2.5 text-label font-semibold"
        aria-label={t("chat.message_failed_retry_aria")}
        onClick={() => void onRetry()}
      >
        <RefreshCw aria-hidden />
        {t("chat.message_failed_retry")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="h-6 rounded-full px-2.5 text-label font-semibold text-muted-foreground"
        onClick={() => useChatSendOutboxStore.getState().remove(clientMsgId)}
      >
        {t("chat.message_failed_discard")}
      </Button>
    </div>
  );
}
