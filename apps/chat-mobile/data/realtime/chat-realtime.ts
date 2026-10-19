// What each chat frame does to the phone's caches: the parity table of the
// native-apps spec §8, mirroring packages/core/realtime/use-realtime-sync.ts
// (its chat cases) and packages/core/chat/realtime-cache.ts. Pure apart from
// the query client it is handed, so chat-realtime.test.ts drives it frame by
// frame; use-chat-realtime.ts wires it to the socket.
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  fetchAndPatchChatMessage,
  patchChatMentionCreated,
  patchChatMessageDeleted,
  patchChatRoomRead,
  type ChatViewer,
} from "../chat-cache";
import { catchUpOnChatSubscribeAck, refreshLoadedRoomTimelines } from "../chat-timeline";
import { chatKeys } from "../queries/chat-keys";
import type { WSMessage } from "./ws-types";

export interface ChatRealtimeDeps {
  wsId: string;
  viewer: () => ChatViewer;
  typing: { bump: (roomId: string, userId: string, currentUserId: string) => void };
  presence: { bump: (userId: string, currentUserId: string) => void; markOffline: (userId: string) => void };
}

/**
 * List-level frames come in bursts (a busy room sends one per message); the
 * rooms list refetches once per burst instead of once per frame.
 */
export const ROOM_ACTIVITY_DEBOUNCE_MS = 300;

export function createChatRealtime(qc: QueryClient, deps: ChatRealtimeDeps) {
  const { wsId } = deps;
  const scheduled = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(...keys: QueryKey[]) {
    for (const key of keys) scheduled.set(JSON.stringify(key), key);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const keys = [...scheduled.values()];
      scheduled.clear();
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    }, ROOM_ACTIVITY_DEBOUNCE_MS);
  }

  function handle(msg: WSMessage): void {
    const payload = (msg.payload ?? {}) as Record<string, string | undefined>;
    if (catchUpOnChatSubscribeAck(qc, wsId, msg.type, payload as Record<string, string>)) return;
    const viewer = deps.viewer();
    const roomId = payload.room_id;
    const messageId = payload.message_id;
    switch (msg.type) {
      case "chat.message.created":
      case "chat.message.updated":
      case "chat.thread.replied":
        if (!roomId || !messageId) return;
        // A thread reply is not unread on the main timeline.
        void fetchAndPatchChatMessage(qc, wsId, viewer, {
          roomId,
          messageId,
          created: msg.type === "chat.message.created" && !payload.thread_root_id,
          senderId: payload.sender_id,
        });
        if (msg.type === "chat.message.created") schedule(chatKeys.unreadSummary());
        return;
      case "chat.message.deleted":
        if (roomId && messageId) patchChatMessageDeleted(qc, wsId, roomId, messageId);
        return;
      case "chat.mention.created":
        if (!roomId) return;
        if (!payload.thread_root_id) patchChatMentionCreated(qc, wsId, viewer, roomId, payload.sender_id ?? "");
        if (messageId) void fetchAndPatchChatMessage(qc, wsId, viewer, { roomId, messageId });
        return;
      case "chat.room.activity":
        schedule(chatKeys.rooms(wsId), chatKeys.unreadSummary());
        return;
      case "chat.room.created":
      case "chat.room.updated":
      case "chat.room.member_added":
      case "chat.room.members_added":
      case "chat.room.member_removed":
        schedule(chatKeys.rooms(wsId), ...(roomId ? [chatKeys.roomMembers(wsId, roomId)] : []));
        return;
      case "chat.channel.created":
      case "chat.channel.updated":
      case "chat.channel.archived":
        schedule(chatKeys.rooms(wsId), chatKeys.discoverableChannels(wsId));
        return;
      case "chat.follow_up.created":
      case "chat.follow_up.updated":
      case "chat.follow_up.completed":
      case "chat.follow_up.deleted":
        schedule(chatKeys.followUps(wsId));
        return;
      case "chat.room.read":
        if (roomId && payload.user_id && viewer.userId) patchChatRoomRead(qc, wsId, viewer.userId, roomId, payload.user_id);
        // The reader's own pointer moved: the per-workspace counts follow.
        if (payload.user_id && payload.user_id === viewer.userId) schedule(chatKeys.unreadSummary());
        return;
      case "chat.typing":
        if (roomId && payload.user_id && viewer.userId) deps.typing.bump(roomId, payload.user_id, viewer.userId);
        return;
      case "user.presence":
        if (payload.user_id && viewer.userId) deps.presence.bump(payload.user_id, viewer.userId);
        return;
      case "user.offline":
        if (payload.user_id) deps.presence.markOffline(payload.user_id);
        return;
      default:
        return;
    }
  }

  /** Frames sent while the socket was down are gone: each cache refreshes its own keys (ADR 0011 §5). */
  function reconnect(): void {
    schedule(chatKeys.rooms(wsId), chatKeys.nicknames(wsId), chatKeys.unreadSummary());
    void qc.invalidateQueries({ queryKey: ["chat", wsId, "thread-messages"] });
    refreshLoadedRoomTimelines(qc, wsId);
  }

  function dispose(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    scheduled.clear();
  }

  return { handle, reconnect, dispose };
}
