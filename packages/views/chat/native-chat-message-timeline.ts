import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import type { PendingChatMessage } from "@uniwork/core/chat/pending-messages-store";
import type { ChatSendOutboxEntry } from "@uniwork/core/chat/send-outbox-store";
import { mergeOptimisticChatMessages } from "@uniwork/core/chat/merge-optimistic-chat-messages";
import type { ChatMessage } from "./chat-messages";
import { toChatMessage } from "./native-chat-message-mapping";

/** Main room timeline: optimistic sends minus first-class thread replies. */
export function buildMainTimelineMessages(input: {
  anchorMessages: ChatMessage[] | null;
  latestRows: ChatMessageRecord[];
  olderMessages: ChatMessage[];
  pendingEntries: PendingChatMessage[];
  outboxEntries: ChatSendOutboxEntry[];
  currentUserId: string;
  workHubEnabled: boolean;
}): ChatMessage[] {
  const {
    anchorMessages,
    latestRows,
    olderMessages,
    pendingEntries,
    outboxEntries,
    currentUserId,
    workHubEnabled,
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
  const withoutThreadReplies = workHubEnabled
    ? mergedLatest.filter((message) => !message.threadRootId)
    : mergedLatest;
  if (olderMessages.length === 0) return withoutThreadReplies;
  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const message of [...olderMessages, ...withoutThreadReplies]) {
    if (seen.has(message.id)) continue;
    if (workHubEnabled && message.threadRootId) continue;
    seen.add(message.id);
    merged.push(message);
  }
  return merged.sort((a, b) => a.ts - b.ts);
}

/** Active thread panel: server thread rows + matching pending, root first. */
export function buildThreadViewMessages(input: {
  allMessages: ChatMessage[];
  threadRoot: ChatMessage;
  threadRows: ChatMessageRecord[] | undefined;
  pendingEntries: PendingChatMessage[];
  currentUserId: string;
  workHubEnabled: boolean;
}): ChatMessage[] {
  const { allMessages, threadRoot, threadRows, pendingEntries, currentUserId, workHubEnabled } =
    input;
  if (workHubEnabled) {
    const serverThread = (threadRows ?? []).map(toChatMessage);
    const threadPending = pendingEntries.filter(
      (entry) => entry.thread_root_id === threadRoot.id,
    );
    const mergedThread = mergeOptimisticChatMessages(
      serverThread,
      threadPending,
      [],
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
