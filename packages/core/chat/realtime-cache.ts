"use client";

import type { QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "../api/endpoints/chat";
import { getChatRoomMessage } from "../api/endpoints/chat";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./chat-keys";
import { useActiveChatRoomStore } from "./active-chat-room-store";

export const CHAT_MESSAGE_CACHE_MAX = 1000;

export function mergeMessageIntoList(
  existing: ChatMessageRecord[] | undefined,
  message: ChatMessageRecord,
): ChatMessageRecord[] {
  const list = existing ?? [];
  const index = list.findIndex((entry) => entry.id === message.id);
  const next =
    index >= 0
      ? [...list.slice(0, index), message, ...list.slice(index + 1)]
      : [...list, message].sort(
          (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
        );
  if (next.length <= CHAT_MESSAGE_CACHE_MAX) return next;
  return next.slice(next.length - CHAT_MESSAGE_CACHE_MAX);
}

export function removeMessageFromList(
  existing: ChatMessageRecord[] | undefined,
  messageId: string,
): ChatMessageRecord[] {
  return (existing ?? []).filter((entry) => entry.id !== messageId);
}

export function patchRoomSidebarFromMessage(
  rooms: ChatRoomRecord[] | undefined,
  roomId: string,
  message: ChatMessageRecord,
  options?: { incrementUnread?: boolean; incrementMentionUnread?: boolean },
): ChatRoomRecord[] {
  if (!rooms) return [];
  const updated = rooms.map((room) => {
    if (room.id !== roomId) return room;
    return {
      ...room,
      last_message_body: message.body,
      last_message_kind: message.kind ?? "text",
      last_message_sender_id: message.sender_id,
      last_message_sender_name: message.sender_display_name,
      last_message_at: message.created_at,
      unread_count:
        options?.incrementUnread === true
          ? (room.unread_count ?? 0) + 1
          : room.unread_count,
      mention_unread_count:
        options?.incrementMentionUnread === true
          ? (room.mention_unread_count ?? 0) + 1
          : room.mention_unread_count,
    };
  });
  return [...updated].sort((a, b) => {
    const aTs = a.last_message_at ? Date.parse(a.last_message_at) : 0;
    const bTs = b.last_message_at ? Date.parse(b.last_message_at) : 0;
    return bTs - aTs;
  });
}

/** Thread replies belong on the root's thread cache, never the main room timeline. */
export function isChatThreadReply(message: ChatMessageRecord): boolean {
  return Boolean(message.thread_root_id);
}

export function bumpThreadRootReplyCount(
  existing: ChatMessageRecord[] | undefined,
  reply: ChatMessageRecord,
): ChatMessageRecord[] | undefined {
  const rootId = reply.thread_root_id;
  if (!existing || !rootId) return existing;
  return existing.map((entry) => {
    if (entry.id !== rootId) return entry;
    return {
      ...entry,
      reply_count: (entry.reply_count ?? 0) + 1,
      last_reply_at: reply.created_at,
    };
  });
}

function patchRoomMessageListIfLoaded(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  patch: (existing: ChatMessageRecord[]) => ChatMessageRecord[],
): void {
  const key = chatKeys.roomMessages(wsId, roomId);
  const existing = qc.getQueryData<ChatMessageRecord[]>(key);
  if (existing === undefined) return;
  qc.setQueryData<ChatMessageRecord[]>(key, patch(existing));
}

function patchWorkspaceMessageListIfLoaded(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  patch: (existing: ChatMessageRecord[]) => ChatMessageRecord[],
): void {
  const wsRoom = qc.getQueryData<{ room_id?: string }>(chatKeys.room(wsId));
  if (wsRoom?.room_id !== roomId) return;
  const key = chatKeys.messages(wsId);
  const existing = qc.getQueryData<ChatMessageRecord[]>(key);
  if (existing === undefined) return;
  qc.setQueryData<ChatMessageRecord[]>(key, patch(existing));
}
function patchThreadReplyCaches(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: ChatMessageRecord,
): void {
  const rootId = message.thread_root_id;
  if (!rootId) return;

  const threadKey = chatKeys.threadMessages(wsId, roomId, rootId);
  const prior = qc.getQueryData<ChatMessageRecord[]>(threadKey);
  const alreadyPresent = prior?.some((entry) => entry.id === message.id) ?? false;

  qc.setQueryData<ChatMessageRecord[]>(threadKey, (old) => mergeMessageIntoList(old, message));

  const patchMainList = (existing: ChatMessageRecord[]) => {
    const withoutReply = removeMessageFromList(existing, message.id);
    if (alreadyPresent) return withoutReply;
    return bumpThreadRootReplyCount(withoutReply, message) ?? withoutReply;
  };

  patchRoomMessageListIfLoaded(qc, wsId, roomId, patchMainList);
  patchWorkspaceMessageListIfLoaded(qc, wsId, roomId, patchMainList);
}

function patchMessageCaches(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: ChatMessageRecord,
): void {
  if (isChatThreadReply(message)) {
    patchThreadReplyCaches(qc, wsId, roomId, message);
    return;
  }
  patchRoomMessageListIfLoaded(qc, wsId, roomId, (existing) =>
    mergeMessageIntoList(existing, message),
  );
  patchWorkspaceMessageListIfLoaded(qc, wsId, roomId, (existing) =>
    mergeMessageIntoList(existing, message),
  );
}

function isViewingRoom(wsId: string, roomId: string): boolean {
  const active = useActiveChatRoomStore.getState();
  return active.workspaceId === wsId && active.roomId === roomId;
}

function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

/**
 * DM/group/channel also emit `chat.room.activity`, which refetches rooms with
 * the server unread count. Local +1 there races into unread=2 for one message.
 * Only the workspace room skips activity, so it still increments locally.
 */
function shouldIncrementUnreadLocally(room: ChatRoomRecord | undefined): boolean {
  return room?.kind === "workspace";
}

export async function fetchAndPatchChatMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  messageId: string,
): Promise<void> {
  const message = await getChatRoomMessage(wsId, roomId, messageId);
  if (!message) return;
  patchMessageCaches(qc, wsId, roomId, message);
  // Thread replies stay off the channel preview; followers get chat.thread.replied.
  if (isChatThreadReply(message)) return;
  const viewerId = currentUserId();
  const isOwn = viewerId != null && message.sender_id === viewerId;
  const viewing = isViewingRoom(wsId, roomId);
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => {
    const room = old?.find((entry) => entry.id === roomId);
    return patchRoomSidebarFromMessage(old, roomId, message, {
      incrementUnread: !isOwn && !viewing && shouldIncrementUnreadLocally(room),
    });
  });
}

export function patchChatMessageDeleted(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  messageId: string,
): void {
  patchRoomMessageListIfLoaded(qc, wsId, roomId, (existing) =>
    removeMessageFromList(existing, messageId),
  );
  patchWorkspaceMessageListIfLoaded(qc, wsId, roomId, (existing) =>
    removeMessageFromList(existing, messageId),
  );
  // Thread message caches are keyed by root; drop the id from any cached thread list.
  qc.setQueriesData<ChatMessageRecord[]>(
    { queryKey: ["chat", "thread-messages", wsId, roomId] },
    (old) => removeMessageFromList(old, messageId),
  );
}

export function patchChatMentionCreated(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  senderId: string,
): void {
  const viewerId = currentUserId();
  if (viewerId == null || senderId === viewerId) return;
  if (isViewingRoom(wsId, roomId)) return;
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => {
    if (!old) return old;
    return old.map((room) => {
      if (room.id !== roomId) return room;
      // Same race as unread: DM/group/channel unread badges come from
      // `chat.room.activity` refetch; only workspace bumps locally.
      if (!shouldIncrementUnreadLocally(room)) return room;
      return { ...room, mention_unread_count: (room.mention_unread_count ?? 0) + 1 };
    });
  });
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
  void qc.invalidateQueries({ queryKey: chatKeys.roomMessageLinksRoot(wsId) });
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
