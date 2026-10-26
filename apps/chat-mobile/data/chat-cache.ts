// How a server message, a realtime frame or a read lands in the phone's query
// cache. The wiring is core's (@uniwork/core/chat/chat-message-cache), shared
// with the web: this file binds it to the phone's keys and transport, and
// adds what the phone keeps beside the timelines (the page around a
// jumped-to message, the copy of a room only the disk holds). The viewer is a
// parameter (the signed-in user and the room on screen). What a frame does to
// one record is core's chat-cache-records. The phone shows neither the web's
// legacy workspace message list nor its task-link lookups.
import type { QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isChatThreadReply, patchRoomSidebarFromMessage, patchRoomRead } from "@uniwork/core/chat/chat-cache-records";
import { createChatMessageCache } from "@uniwork/core/chat/chat-message-cache";
import { chatApi } from "./chat-api";
import { chatKeys } from "./queries/chat-keys";
import { dropCarriedTimeline } from "./query-persister";
import { sameUser } from "@/lib/user-id";

export type { ChatViewer } from "@uniwork/core/chat/chat-message-cache";

/** The page around a jumped-to message is read once and never patched: a change refetches it if shown. */
function refreshAroundPages(qc: QueryClient, wsId: string, roomId: string): void {
  void qc.invalidateQueries({ queryKey: chatKeys.roomAroundRoot(wsId, roomId) });
}

const cache = createChatMessageCache({
  keys: {
    rooms: chatKeys.rooms,
    roomMessages: chatKeys.roomMessages,
    threadMessages: chatKeys.threadMessages,
    roomThreads: chatKeys.roomThreads,
  },
  getMessage: (wsId, roomId, messageId) => chatApi.getMessage(wsId, roomId, messageId),
  onMessagePlaced: (qc, wsId, roomId) => refreshAroundPages(qc, wsId, roomId),
  // An edit or a reaction on a room nobody shows: a copy of it only the disk holds would keep the old one.
  onUnshownFrame: (_qc, wsId, roomId, created) => {
    if (!created) dropCarriedTimeline(wsId, roomId);
  },
  onMessageDeleted: (qc, wsId, roomId) => {
    refreshAroundPages(qc, wsId, roomId);
    // A copy of this room only the disk holds would show the deleted message on the next offline start.
    dropCarriedTimeline(wsId, roomId);
  },
});

export const { fetchAndPatchChatMessage, patchChatMessageDeleted, patchChatMentionCreated } = cache;

/**
 * A chat mutation's answer: the server's copy of the message it sent or
 * changed goes into the caches, so the room is not refetched page by page.
 * Without one, the room refetches. A send also moves the room's preview in
 * the list.
 */
export function applyChatMessageResponse(qc: QueryClient, wsId: string, roomId: string, message: ChatMessageRecord | null, created: boolean): void {
  cache.applyChatMessageResponse(qc, wsId, roomId, message, created);
  if (message && created && !isChatThreadReply(message)) {
    qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => old && patchRoomSidebarFromMessage(old, roomId, message));
  }
}

/** `chat.room.read`: my own read (on any device) clears the room's badges; a peer's moves a DM's "Seen" (C3). */
export function patchChatRoomRead(qc: QueryClient, wsId: string, viewerId: string, roomId: string, userId: string): void {
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => patchRoomRead(old, roomId, sameUser(userId, viewerId)));
}

/** A signed media URL past its expiry: load the message again; its fresh URLs flow back through the cache. */
export async function refreshMessageMedia(qc: QueryClient, wsId: string, roomId: string, messageId: string): Promise<ChatMessageRecord | null> {
  const fresh = await chatApi.getMessage(wsId, roomId, messageId);
  if (fresh) applyChatMessageResponse(qc, wsId, roomId, fresh, false);
  return fresh;
}
