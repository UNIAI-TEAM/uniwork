"use client";

// The web's binding of chat-message-cache.ts (shared with the phone): its keys,
// its transport, its viewer (the auth and active-room stores), and what it
// keeps beside the timelines — the info panel's shared-media summary and the
// task/doc link lookups.
import type { QueryClient } from "@tanstack/react-query";
import { getChatRoomMessage } from "../api/endpoints/chat";
import { useAuthStore } from "../auth/store";
import { useActiveChatRoomStore } from "./active-chat-room-store";
import { isChatThreadReply } from "./chat-cache-records";
import { chatKeys } from "./chat-keys";
import { createChatMessageCache, type ChatViewer } from "./chat-message-cache";

/** A message created or deleted on the main timeline can change the info panel's media counts. */
export function invalidateRoomSharedSummary(qc: QueryClient, wsId: string, roomId: string): void {
  const queryKey = chatKeys.roomSharedSummary(wsId, roomId);
  // Only a summary someone loaded can be stale; skipping the rest keeps message frames to their timeline patch.
  if (!qc.getQueryState(queryKey)) return;
  void qc.invalidateQueries({ queryKey });
}

/**
 * A message that just arrived cannot have task/doc links yet; a later link
 * sends `chat.message.linked`. Recording it as linkless keeps the open room
 * from asking the server for links on every frame.
 */
function recordNoLinksYet(qc: QueryClient, wsId: string, roomId: string, messageId: string): void {
  const key = chatKeys.roomMessageLinksRoom(wsId, roomId);
  const links = qc.getQueryData<Map<string, unknown[]>>(key);
  if (!links || links.has(messageId)) return;
  qc.setQueryData(key, new Map(links).set(messageId, []));
}

const cache = createChatMessageCache({
  keys: {
    rooms: chatKeys.rooms,
    roomMessages: chatKeys.roomMessages,
    threadMessages: chatKeys.threadMessages,
    roomThreads: (wsId, roomId) => ["chat", "thread-messages", wsId, roomId],
  },
  getMessage: (wsId, roomId, messageId) => getChatRoomMessage(wsId, roomId, messageId),
  onMessagePlaced: (qc, wsId, roomId, message, created) => {
    if (created && !isChatThreadReply(message)) invalidateRoomSharedSummary(qc, wsId, roomId);
  },
  onUnshownFrame: (qc, wsId, roomId, created) => {
    if (created) invalidateRoomSharedSummary(qc, wsId, roomId);
  },
  onMessageDeleted: invalidateRoomSharedSummary,
  onMessageFetched: (qc, wsId, roomId, messageId, knownBefore) => {
    if (!knownBefore) recordNoLinksYet(qc, wsId, roomId, messageId);
  },
});

/** The stores are read when the cache asks (after a fetch in flight settles), not when the frame arrived. */
function webViewer(wsId: string): ChatViewer {
  return {
    get userId() {
      return useAuthStore.getState().user?.id ?? null;
    },
    get activeRoomId() {
      const active = useActiveChatRoomStore.getState();
      return active.workspaceId === wsId ? active.roomId : null;
    },
  };
}

export const { applyChatMessageResponse, insertCreatedRoomMessage, patchChatMessageDeleted } = cache;

/**
 * Apply one `chat.message.*` frame. `created` is true only for
 * `chat.message.created`: edits and reactions are not unread. `senderId` is
 * that frame's `sender_id`, when it carries one.
 */
export function fetchAndPatchChatMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  messageId: string,
  created = false,
  senderId?: string,
): Promise<void> {
  return cache.fetchAndPatchChatMessage(qc, wsId, webViewer(wsId), { roomId, messageId, created, senderId });
}

export function patchChatMentionCreated(qc: QueryClient, wsId: string, roomId: string, senderId: string): void {
  cache.patchChatMentionCreated(qc, wsId, webViewer(wsId), roomId, senderId);
}

/**
 * Invalidate message↔task link queries. Does not touch message list caches so
 * optimistic / pending sends stay put.
 */
export function invalidateChatMessageLinks(
  qc: QueryClient,
  wsId: string,
  messageId: string,
): void {
  if (!messageId) return;
  void qc.invalidateQueries({ queryKey: chatKeys.messageLinks(wsId, messageId) });
  // The message id does not name its room: refresh every open linked-task list.
  void qc.invalidateQueries({ queryKey: chatKeys.roomLinkedTasksRoot(wsId) });
  // The room cache only fetches ids it lacks: forget this one so the open
  // timeline asks for its links, and nothing else, again.
  qc.setQueriesData<Map<string, unknown[]>>(
    { queryKey: chatKeys.roomMessageLinksRoot(wsId) },
    (links) => {
      if (!links?.has(messageId)) return links;
      const next = new Map(links);
      next.delete(messageId);
      return next;
    },
  );
}

/** `chat.message.linked` — refresh links for the message; leave message lists alone. */
export function patchChatMessageLinked(
  qc: QueryClient,
  wsId: string,
  _roomId: string,
  messageId: string,
): void {
  invalidateChatMessageLinks(qc, wsId, messageId);
}

/** `chat.thread.linked` — links hang off the thread root message id. */
export function patchChatThreadLinked(
  qc: QueryClient,
  wsId: string,
  _roomId: string,
  threadRootId: string,
): void {
  invalidateChatMessageLinks(qc, wsId, threadRootId);
}
