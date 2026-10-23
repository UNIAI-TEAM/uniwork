import type { ComposerMessagePriority } from "./composer-priority";
import { mergeOptimisticMessages, type ServerLikeChatMessage } from "./optimistic-merge";
import { pendingChatMessageId } from "./pending-message-id";
import type { PendingChatMessage } from "./pending-messages-store";
import type { ChatSendOutboxEntry } from "./send-outbox-store";

export type OptimisticChatMessage = {
  id: string;
  sender: string;
  body: string;
  kind?: string;
  ts: number;
  replyToEventId?: string;
  threadRootId?: string;
  priority?: ComposerMessagePriority;
  reactions: Record<string, number>;
  clientMsgId: string;
  deliveryStatus: "sending" | "queued" | "failed";
};

export function pendingToOptimisticChatMessage(
  entry: PendingChatMessage,
): OptimisticChatMessage {
  return {
    id: pendingChatMessageId(entry.client_msg_id),
    clientMsgId: entry.client_msg_id,
    sender: entry.senderId,
    body: entry.body,
    ts: entry.createdAt,
    replyToEventId: entry.reply_to_message_id,
    threadRootId: entry.thread_root_id,
    priority: entry.priority,
    reactions: {},
    deliveryStatus: entry.status,
  };
}

export function outboxToOptimisticChatMessage(
  entry: ChatSendOutboxEntry,
  senderId: string,
): OptimisticChatMessage {
  return {
    id: pendingChatMessageId(entry.client_msg_id),
    clientMsgId: entry.client_msg_id,
    sender: senderId,
    body: entry.body,
    ts: Date.parse(entry.queued_at) || Date.now(),
    replyToEventId: entry.reply_to_message_id,
    threadRootId: entry.thread_root_id,
    priority: entry.priority,
    reactions: {},
    deliveryStatus: entry.failed_at ? "failed" : "queued",
  };
}

/** The web keeps two lists (in-flight sends and the persisted outbox); one entry shows once, then optimistic-merge.ts joins them. */
export function mergeOptimisticChatMessages<T extends ServerLikeChatMessage>(
  serverMessages: T[],
  pending: PendingChatMessage[],
  outbox: ChatSendOutboxEntry[],
  currentUserId: string,
): Array<T | OptimisticChatMessage> {
  const optimistic = pending.map(pendingToOptimisticChatMessage);
  for (const entry of outbox) {
    if (pending.some((item) => item.client_msg_id === entry.client_msg_id)) continue;
    optimistic.push(outboxToOptimisticChatMessage(entry, currentUserId));
  }
  return mergeOptimisticMessages(serverMessages, optimistic, currentUserId);
}
