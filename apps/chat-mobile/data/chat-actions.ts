// The chat tab's one-shot commands and what each does to the cache, mirroring
// the mutations of packages/core/chat/{chat-hooks-rooms,chat-hooks-messages,
// thread-hooks}.ts. Screens await them; a rejection is the screen's to show.
import type { QueryClient } from "@tanstack/react-query";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { applyChatMessageResponse, patchChatMessageDeleted } from "./chat-cache";
import { chatApi } from "./chat-api";
import { chatKeys } from "./queries/chat-keys";

function clearUnread(qc: QueryClient, wsId: string, roomId: string): void {
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) =>
    old?.map((room) => (room.id === roomId ? { ...room, unread_count: 0, mention_unread_count: 0 } : room)),
  );
}

/** Opening a room, reaching its newest message, or leaving it: the badge clears now, the server follows. */
export async function markRoomRead(qc: QueryClient, wsId: string, roomId: string): Promise<void> {
  clearUnread(qc, wsId, roomId);
  if (await chatApi.markRoomRead(wsId, roomId)) clearUnread(qc, wsId, roomId);
}

/** The read pointer of a thread; the server hands back the one it replaced. */
export function markThreadRead(wsId: string, rootId: string): Promise<string | null> {
  return chatApi.markThreadRead(wsId, rootId);
}

/** Optimistic: the flag moves only this person's row, and a failure restores it. */
export async function setRoomMuted(qc: QueryClient, wsId: string, roomId: string, muted: boolean): Promise<void> {
  const key = chatKeys.rooms(wsId);
  await qc.cancelQueries({ queryKey: key });
  const previous = qc.getQueryData<ChatRoomRecord[]>(key);
  qc.setQueryData<ChatRoomRecord[]>(key, (old) =>
    old?.map((room) => (room.id === roomId ? { ...room, notifications_muted: muted } : room)),
  );
  const ok = await chatApi.setRoomMuted(wsId, roomId, muted).catch(() => false);
  if (!ok) {
    qc.setQueryData(key, previous);
    throw new Error("chat_room_mute_failed");
  }
}

export async function toggleReaction(qc: QueryClient, wsId: string, roomId: string, messageId: string, emoji: string): Promise<void> {
  applyChatMessageResponse(qc, wsId, roomId, await chatApi.toggleReaction(wsId, roomId, messageId, emoji), false);
}

export async function editMessage(qc: QueryClient, wsId: string, roomId: string, messageId: string, body: string): Promise<void> {
  applyChatMessageResponse(qc, wsId, roomId, await chatApi.editMessage(wsId, roomId, messageId, body), false);
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
}

export async function deleteMessage(qc: QueryClient, wsId: string, roomId: string, messageId: string): Promise<void> {
  if (!(await chatApi.deleteMessage(wsId, roomId, messageId))) throw new Error("chat_message_delete_failed");
  patchChatMessageDeleted(qc, wsId, roomId, messageId);
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
}

/** A signed media URL past its expiry: load the message again; its fresh URLs flow back through the cache. */
export async function refreshMessageMedia(qc: QueryClient, wsId: string, roomId: string, messageId: string) {
  const fresh = await chatApi.getMessage(wsId, roomId, messageId);
  if (fresh) applyChatMessageResponse(qc, wsId, roomId, fresh, false);
  return fresh;
}

/** The DM with a person, created on first use; null when the server answers none. */
export async function resolveDMRoom(qc: QueryClient, wsId: string, userId: string): Promise<ChatRoomRecord | null> {
  const room = await chatApi.resolveDMRoom(wsId, userId);
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
  return room;
}

export async function joinChannel(qc: QueryClient, wsId: string, roomId: string): Promise<ChatRoomRecord | null> {
  const room = await chatApi.joinChannel(wsId, roomId);
  await qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
  void qc.invalidateQueries({ queryKey: chatKeys.discoverableChannels(wsId) });
  return room;
}

export async function leaveRoom(qc: QueryClient, wsId: string, roomId: string): Promise<void> {
  if (!(await chatApi.leaveRoom(wsId, roomId))) throw new Error("chat_room_leave_failed");
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => old?.filter((room) => room.id !== roomId));
  qc.removeQueries({ queryKey: chatKeys.roomMessages(wsId, roomId) });
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
  void qc.invalidateQueries({ queryKey: chatKeys.discoverableChannels(wsId) });
}
