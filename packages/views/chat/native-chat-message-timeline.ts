import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import type { PendingChatMessage } from "@uniwork/core/chat/pending-messages-store";
import type { ChatSendOutboxEntry } from "@uniwork/core/chat/send-outbox-store";
import { mergeOptimisticChatMessages } from "@uniwork/core/chat/merge-optimistic-chat-messages";
import type { ChatMessage } from "./chat-messages";
import { toChatMessage } from "./native-chat-message-mapping";

/** Main room timeline (every loaded page): optimistic sends minus first-class thread replies. */
export function buildMainTimelineMessages(input: {
  anchorMessages: ChatMessage[] | null;
  latestRows: ChatMessageRecord[];
  pendingEntries: PendingChatMessage[];
  outboxEntries: ChatSendOutboxEntry[];
  currentUserId: string;
  threadsEnabled: boolean;
}): ChatMessage[] {
  const {
    anchorMessages,
    latestRows,
    pendingEntries,
    outboxEntries,
    currentUserId,
    threadsEnabled,
  } = input;
  if (anchorMessages) return anchorMessages;
  const latest = latestRows.map(toChatMessage);
  const mainPending = pendingEntries.filter((entry) => !entry.thread_root_id);
  const mergedLatest = mergeOptimisticChatMessages(
    latest,
    mainPending,
    outboxEntries,
    currentUserId,
  ) as ChatMessage[];
  return threadsEnabled ? mergedLatest.filter((message) => !message.threadRootId) : mergedLatest;
}

/** Active thread panel: server thread rows + matching pending and queued sends, root first. */
export function buildThreadViewMessages(input: {
  allMessages: ChatMessage[];
  threadRoot: ChatMessage;
  threadRows: ChatMessageRecord[] | undefined;
  pendingEntries: PendingChatMessage[];
  outboxEntries: ChatSendOutboxEntry[];
  currentUserId: string;
  threadsEnabled: boolean;
}): ChatMessage[] {
  const {
    allMessages,
    threadRoot,
    threadRows,
    pendingEntries,
    outboxEntries,
    currentUserId,
    threadsEnabled,
  } = input;
  if (threadsEnabled) {
    const serverThread = (threadRows ?? []).map(toChatMessage);
    const threadPending = pendingEntries.filter(
      (entry) => entry.thread_root_id === threadRoot.id,
    );
    const mergedThread = mergeOptimisticChatMessages(
      serverThread,
      threadPending,
      outboxEntries.filter((entry) => entry.thread_root_id === threadRoot.id),
      currentUserId,
    ) as ChatMessage[];
    const rootRow = allMessages.find((message) => message.id === threadRoot.id) ?? threadRoot;
    const withoutDupRoot = mergedThread.filter((message) => message.id !== rootRow.id);
    return [rootRow, ...withoutDupRoot].sort((a, b) => a.ts - b.ts);
  }
  return allMessages.filter(
    (message) =>
      message.id === threadRoot.id || message.replyToEventId === threadRoot.id,
  );
}

/** Messages from others after `sinceId`: what arrived while the reader was scrolled away. */
export function countNewSince(messages: ChatMessage[], sinceId: string | null, currentUserId: string): number {
  const since = sinceId ? messages.findIndex((message) => message.id === sinceId) : -1;
  if (since < 0) return 0;
  return messages.slice(since + 1).filter((message) => message.sender !== currentUserId).length;
}
