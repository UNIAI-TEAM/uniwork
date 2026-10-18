import * as chat from "../api/endpoints/chat";
import type { ComposerMessagePriority } from "./composer-priority";
import { usePendingChatMessagesStore } from "./pending-messages-store";
import { isChatSendNetworkError, isPermanentChatSendRefusal, runWithChatSendRetry } from "./send-retry";
import type { ChatSendOutboxEntry } from "./send-outbox-store";
import { useChatSendOutboxStore } from "./send-outbox-store";

export type ChatTextSendPayload = {
  roomId: string;
  body: string;
  client_msg_id: string;
  reply_to_message_id?: string;
  priority?: ComposerMessagePriority;
  /** Set for a thread reply; without it a queued reply lands in the channel. */
  thread_root_id?: string;
};

export async function deliverChatTextMessage(workspaceId: string, payload: ChatTextSendPayload) {
  const threadRootId = payload.thread_root_id;
  if (threadRootId) {
    return runWithChatSendRetry(() =>
      chat.sendChatThreadMessage(workspaceId, payload.roomId, threadRootId, {
        body: payload.body,
        client_msg_id: payload.client_msg_id,
        priority: payload.priority,
      }),
    );
  }
  return runWithChatSendRetry(() =>
    chat.sendChatRoomMessage(workspaceId, payload.roomId, payload),
  );
}

/** `failed`: the send reached the server and failed, so the bubble offers "Thử lại" at once. */
export function outboxEntryFromPayload(
  workspaceId: string,
  senderId: string,
  payload: ChatTextSendPayload,
  options?: { failed?: boolean },
): ChatSendOutboxEntry {
  const now = new Date().toISOString();
  return {
    workspaceId,
    senderId,
    roomId: payload.roomId,
    body: payload.body,
    client_msg_id: payload.client_msg_id,
    reply_to_message_id: payload.reply_to_message_id,
    priority: payload.priority,
    thread_root_id: payload.thread_root_id,
    queued_at: now,
    ...(options?.failed ? { failed_at: now } : {}),
  };
}

export function payloadFromOutboxEntry(entry: ChatSendOutboxEntry): ChatTextSendPayload {
  return {
    roomId: entry.roomId,
    body: entry.body,
    client_msg_id: entry.client_msg_id,
    reply_to_message_id: entry.reply_to_message_id,
    priority: entry.priority,
    thread_root_id: entry.thread_root_id,
  };
}

export type ChatOutboxDelivery =
  | { outcome: "sent" | "queued" }
  | { outcome: "failed" | "dropped"; error: unknown };

/**
 * One outbox entry through the send path, shown as sending meanwhile. Per error kind:
 * - a permanent refusal (403 removed or blocked, 404, 410, 422) is dropped and
 *   handed back for the caller to say why: "Thử lại" could never succeed;
 * - the network (TypeError) leaves it queued for the next reconnect, as before;
 * - anything else (5xx, 408, 429, 401) leaves it failed: "Chưa gửi được" with
 *   "Thử lại", since with the network up no reconnect would retry it.
 * Null when this entry is already on its way (a flush and a "Thử lại" racing).
 */
export async function deliverChatOutboxEntry(
  entry: ChatSendOutboxEntry,
  onDeliver: (payload: ChatTextSendPayload) => Promise<unknown>,
): Promise<ChatOutboxDelivery | null> {
  const pending = usePendingChatMessagesStore.getState();
  if (pending.entries.some((item) => item.client_msg_id === entry.client_msg_id)) return null;
  pending.upsert({
    workspaceId: entry.workspaceId,
    roomId: entry.roomId,
    client_msg_id: entry.client_msg_id,
    body: entry.body,
    senderId: entry.senderId,
    createdAt: Date.parse(entry.queued_at) || Date.now(),
    reply_to_message_id: entry.reply_to_message_id,
    thread_root_id: entry.thread_root_id,
    priority: entry.priority,
    status: "sending",
  });
  const outbox = useChatSendOutboxStore.getState();
  try {
    await onDeliver(payloadFromOutboxEntry(entry));
    outbox.remove(entry.client_msg_id);
    return { outcome: "sent" };
  } catch (error) {
    if (isPermanentChatSendRefusal(error)) {
      // Kept, it would show as waiting for a day, then vanish unannounced.
      outbox.remove(entry.client_msg_id);
      return { outcome: "dropped", error };
    }
    const queued = isChatSendNetworkError(error);
    outbox.setFailed(entry.client_msg_id, !queued);
    return queued ? { outcome: "queued" } : { outcome: "failed", error };
  } finally {
    usePendingChatMessagesStore.getState().remove(entry.client_msg_id);
  }
}

export async function flushChatSendOutbox(
  workspaceId: string,
  senderId: string,
  onDeliver: (payload: ChatTextSendPayload) => Promise<unknown>,
): Promise<{ sent: number; failed: number; dropped: number }> {
  // Expired entries are dropped rather than sent; another user's entries are
  // left alone — they are theirs to deliver when they sign back in.
  useChatSendOutboxStore.getState().pruneStale();
  const pending = useChatSendOutboxStore.getState().listForWorkspace(workspaceId, senderId);
  let sent = 0;
  let failed = 0;
  let dropped = 0;

  for (const entry of pending) {
    const result = await deliverChatOutboxEntry(entry, onDeliver);
    if (!result) continue;
    if (result.outcome === "sent") sent += 1;
    else if (result.outcome === "dropped") dropped += 1;
    else failed += 1;
  }

  return { sent, failed, dropped };
}
