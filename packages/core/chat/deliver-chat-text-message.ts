import * as chat from "../api/endpoints/chat";
import type { ComposerMessagePriority } from "./composer-priority";
import { usePendingChatMessagesStore } from "./pending-messages-store";
import { runWithChatSendRetry } from "./send-retry";
import type { ChatSendOutboxEntry } from "./send-outbox-store";
import { useChatSendOutboxStore } from "./send-outbox-store";

export type ChatTextSendPayload = {
  roomId: string;
  body: string;
  client_msg_id: string;
  reply_to_message_id?: string;
  priority?: ComposerMessagePriority;
};

export async function deliverChatTextMessage(workspaceId: string, payload: ChatTextSendPayload) {
  return runWithChatSendRetry(() =>
    chat.sendChatRoomMessage(workspaceId, payload.roomId, payload),
  );
}

export function outboxEntryFromPayload(
  workspaceId: string,
  payload: ChatTextSendPayload,
): ChatSendOutboxEntry {
  return {
    workspaceId,
    roomId: payload.roomId,
    body: payload.body,
    client_msg_id: payload.client_msg_id,
    reply_to_message_id: payload.reply_to_message_id,
    priority: payload.priority,
    queued_at: new Date().toISOString(),
  };
}

export function payloadFromOutboxEntry(entry: ChatSendOutboxEntry): ChatTextSendPayload {
  return {
    roomId: entry.roomId,
    body: entry.body,
    client_msg_id: entry.client_msg_id,
    reply_to_message_id: entry.reply_to_message_id,
    priority: entry.priority,
  };
}

export async function flushChatSendOutbox(
  workspaceId: string,
  senderId: string,
  onDeliver: (payload: ChatTextSendPayload) => Promise<unknown>,
): Promise<{ sent: number; failed: number }> {
  const { listForWorkspace, remove } = useChatSendOutboxStore.getState();
  const pending = listForWorkspace(workspaceId);
  let sent = 0;
  let failed = 0;

  for (const entry of pending) {
    usePendingChatMessagesStore.getState().upsert({
      workspaceId,
      roomId: entry.roomId,
      client_msg_id: entry.client_msg_id,
      body: entry.body,
      senderId,
      createdAt: Date.parse(entry.queued_at) || Date.now(),
      reply_to_message_id: entry.reply_to_message_id,
      priority: entry.priority,
      status: "sending",
    });
    try {
      await onDeliver(payloadFromOutboxEntry(entry));
      remove(entry.client_msg_id);
      usePendingChatMessagesStore.getState().remove(entry.client_msg_id);
      sent += 1;
    } catch {
      usePendingChatMessagesStore.getState().remove(entry.client_msg_id);
      failed += 1;
    }
  }

  return { sent, failed };
}
