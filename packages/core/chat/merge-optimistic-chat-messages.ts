import type { ComposerMessagePriority } from "./composer-priority";
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
  priority?: ComposerMessagePriority;
  reactions: Record<string, number>;
  clientMsgId: string;
  deliveryStatus: "sending" | "queued";
};

type ServerLikeMessage = {
  id: string;
  sender: string;
  body: string;
  ts: number;
  /** Echo of the sender's idempotency key; absent on messages sent elsewhere. */
  clientMsgId?: string;
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
    priority: entry.priority,
    reactions: {},
    deliveryStatus: "queued",
  };
}

/**
 * The server echoes the idempotency key, so the local copy disappears on an
 * exact match. Matching on body and a timestamp window instead left a
 * duplicate bubble on screen forever whenever the browser clock drifted from
 * the server or the queued entry outlived the window.
 */
export function shouldHideOptimisticMessage<T extends ServerLikeMessage>(
  optimistic: OptimisticChatMessage,
  serverMessages: T[],
  currentUserId: string,
): boolean {
  if (optimistic.sender !== currentUserId) return false;
  return serverMessages.some((message) => message.clientMsgId === optimistic.clientMsgId);
}

export function mergeOptimisticChatMessages<T extends ServerLikeMessage>(
  serverMessages: T[],
  pending: PendingChatMessage[],
  outbox: ChatSendOutboxEntry[],
  currentUserId: string,
): Array<T | OptimisticChatMessage> {
  const optimistic: OptimisticChatMessage[] = [];

  for (const entry of pending) {
    optimistic.push(pendingToOptimisticChatMessage(entry));
  }

  for (const entry of outbox) {
    if (pending.some((item) => item.client_msg_id === entry.client_msg_id)) continue;
    optimistic.push(outboxToOptimisticChatMessage(entry, currentUserId));
  }

  const visibleOptimistic = optimistic.filter(
    (message) => !shouldHideOptimisticMessage(message, serverMessages, currentUserId),
  );

  return [...serverMessages, ...visibleOptimistic].sort((left, right) => left.ts - right.ts);
}
