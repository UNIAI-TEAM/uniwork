"use client";

import type { QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "../api/endpoints/chat";
import { getChatRoomMessage } from "../api/endpoints/chat";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./hooks";
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

function patchMessageCaches(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: ChatMessageRecord,
): void {
  qc.setQueryData<ChatMessageRecord[]>(chatKeys.roomMessages(wsId, roomId), (old) =>
    mergeMessageIntoList(old, message),
  );
  const wsRoom = qc.getQueryData<{ room_id?: string }>(chatKeys.room(wsId));
  if (wsRoom?.room_id === roomId) {
    qc.setQueryData<ChatMessageRecord[]>(chatKeys.messages(wsId), (old) =>
      mergeMessageIntoList(old, message),
    );
  }
}

function isViewingRoom(wsId: string, roomId: string): boolean {
  const active = useActiveChatRoomStore.getState();
  return active.workspaceId === wsId && active.roomId === roomId;
}

function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
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
  const viewerId = currentUserId();
  const isOwn = viewerId != null && message.sender_id === viewerId;
  const viewing = isViewingRoom(wsId, roomId);
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) =>
    patchRoomSidebarFromMessage(old, roomId, message, {
      incrementUnread: !isOwn && !viewing,
    }),
  );
}

export function patchChatMessageDeleted(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  messageId: string,
): void {
  qc.setQueryData<ChatMessageRecord[]>(chatKeys.roomMessages(wsId, roomId), (old) =>
    removeMessageFromList(old, messageId),
  );
  const wsRoom = qc.getQueryData<{ room_id?: string }>(chatKeys.room(wsId));
  if (wsRoom?.room_id === roomId) {
    qc.setQueryData<ChatMessageRecord[]>(chatKeys.messages(wsId), (old) =>
      removeMessageFromList(old, messageId),
    );
  }
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
    return old.map((room) =>
      room.id === roomId
        ? { ...room, mention_unread_count: (room.mention_unread_count ?? 0) + 1 }
        : room,
    );
  });
}
