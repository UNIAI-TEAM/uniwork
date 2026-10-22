// What each chat frame does to the phone's caches: the parity table of the
// native-apps spec §8, mirroring packages/core/realtime/use-realtime-sync.ts
// (its chat cases). A message frame lands through core's shared cache wiring
// (chat-message-cache, bound in ../chat-cache.ts). Pure apart from the query
// client it is handed, so chat-realtime.test.ts drives it frame by frame;
// use-chat-realtime.ts wires it to the socket.
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  fetchAndPatchChatMessage,
  patchChatMentionCreated,
  patchChatMessageDeleted,
  patchChatRoomRead,
  type ChatViewer,
} from "../chat-cache";
import { catchUpOnChatSubscribeAck, catchUpRoomTimeline, refreshLoadedRoomTimelines } from "../chat-timeline";
import { chatKeys } from "../queries/chat-keys";
import { roomWasRead } from "../room-read-signal";
import { roomTimelineHas, type RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { sameUser } from "@/lib/user-id";
import { isKnownFrame, type RealtimeFrame } from "./frames";

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

/**
 * A busy room sends a frame per message and the phone used to GET each one
 * (there are no sequence events). One GET per room runs at a time; the frames
 * that pile up behind it are read together: this many new messages or more,
 * on a timeline someone shows, is one catch-up read instead of a GET each.
 */
export const BURST_CATCH_UP_MIN = 2;

interface MessageFrame {
  roomId: string;
  messageId: string;
  /** A new main-timeline message (counts as unread, can be read by a catch-up). */
  created: boolean;
  senderId?: string;
  threadRootId?: string;
}

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

  /**
   * The echo of a message this phone sent: the POST's answer already put the
   * server's copy in the timeline (chat-send.ts › applyChatMessageResponse) and
   * moved the room's preview, so its frame needs no GET. Another device's send
   * is not in the cache and is read as any other.
   */
  function isOwnEcho(roomId: string, messageId: string, senderId: string | undefined, threadRootId: string | undefined): boolean {
    const { userId } = deps.viewer();
    if (!userId || !senderId || !sameUser(senderId, userId)) return false;
    const key = threadRootId ? chatKeys.threadMessages(wsId, roomId, threadRootId) : chatKeys.roomMessages(wsId, roomId);
    return roomTimelineHas(qc.getQueryData<RoomTimeline>(key), messageId);
  }

  const isShown = (roomId: string) =>
    (qc.getQueryCache().find({ queryKey: chatKeys.roomMessages(wsId, roomId), exact: true })?.getObserversCount() ?? 0) > 0;

  /**
   * A frame whose GET failed is not dropped: a new message is read
   * by a catch-up, anything else refetches the room (and its thread), and the
   * list follows, so the message shows without reopening the room.
   */
  function recover(frame: MessageFrame): void {
    const roomKey = chatKeys.roomMessages(wsId, frame.roomId);
    if (frame.created) void catchUpRoomTimeline(qc, wsId, frame.roomId).catch(() => qc.invalidateQueries({ queryKey: roomKey }));
    else void qc.invalidateQueries({ queryKey: roomKey });
    if (frame.threadRootId) void qc.invalidateQueries({ queryKey: chatKeys.threadMessages(wsId, frame.roomId, frame.threadRootId) });
    schedule(chatKeys.rooms(wsId), chatKeys.unreadSummary());
  }

  function patchOne(frame: MessageFrame): Promise<void> {
    const { roomId, messageId, created, senderId } = frame;
    return fetchAndPatchChatMessage(qc, wsId, deps.viewer(), { roomId, messageId, created, senderId }).catch(() => recover(frame));
  }

  // One line of frames per room: the frames that arrive while it reads are merged by message and read next.
  const lines = new Map<string, Map<string, MessageFrame>>();

  async function drain(roomId: string, queue: Map<string, MessageFrame>): Promise<void> {
    try {
      while (queue.size > 0) {
        const frames = [...queue.values()];
        queue.clear();
        const fresh = frames.filter((frame) => frame.created && !frame.threadRootId);
        const burst = fresh.length >= BURST_CATCH_UP_MIN && isShown(roomId);
        if (burst) {
          await catchUpRoomTimeline(qc, wsId, roomId).catch(() => recover(fresh[0]!));
          // The previews and counts come from the list, not from each message.
          schedule(chatKeys.rooms(wsId), chatKeys.unreadSummary());
        }
        for (const frame of burst ? frames.filter((f) => !fresh.includes(f)) : frames) await patchOne(frame);
      }
    } finally {
      lines.delete(roomId);
    }
  }

  function enqueueFrame(frame: MessageFrame): void {
    const running = lines.get(frame.roomId);
    const queue = running ?? new Map<string, MessageFrame>();
    const prior = queue.get(frame.messageId);
    queue.set(frame.messageId, prior ? { ...frame, created: prior.created || frame.created, senderId: frame.senderId ?? prior.senderId } : frame);
    if (running) return;
    lines.set(frame.roomId, queue);
    void drain(frame.roomId, queue);
  }

  /** One decoded frame (frames.ts: a malformed one never gets here, so every id below is a non-empty string). */
  function handle(msg: RealtimeFrame): void {
    if (!isKnownFrame(msg)) return;
    const viewer = deps.viewer();
    switch (msg.type) {
      case "subscribe_ack":
        catchUpOnChatSubscribeAck(qc, wsId, msg.type, msg.payload);
        return;
      case "chat.message.created":
      case "chat.message.updated":
      case "chat.thread.replied": {
        const { room_id: roomId, message_id: messageId } = msg.payload;
        const senderId = msg.type === "chat.message.created" ? msg.payload.sender_id : undefined;
        const threadRootId = msg.type === "chat.message.updated" ? undefined : msg.payload.thread_root_id;
        if (msg.type === "chat.message.created" && isOwnEcho(roomId, messageId, senderId, threadRootId)) return;
        // A thread reply is not unread on the main timeline.
        enqueueFrame({ roomId, messageId, created: msg.type === "chat.message.created" && !threadRootId, senderId, threadRootId });
        if (msg.type === "chat.message.created") schedule(chatKeys.unreadSummary());
        return;
      }
      case "chat.message.deleted":
        patchChatMessageDeleted(qc, wsId, msg.payload.room_id, msg.payload.message_id);
        return;
      case "chat.mention.created": {
        const { room_id: roomId, message_id: messageId, thread_root_id: threadRootId } = msg.payload;
        if (!threadRootId) patchChatMentionCreated(qc, wsId, viewer, roomId, msg.payload.sender_id ?? "");
        if (messageId) enqueueFrame({ roomId, messageId, created: false, threadRootId });
        return;
      }
      case "chat.room.activity":
        schedule(chatKeys.rooms(wsId), chatKeys.unreadSummary());
        return;
      case "chat.room.created":
      case "chat.room.updated":
      case "chat.room.member_added":
      case "chat.room.members_added":
      case "chat.room.member_removed": {
        const roomId = msg.payload.room_id;
        schedule(chatKeys.rooms(wsId), ...(roomId ? [chatKeys.roomMembers(wsId, roomId)] : []));
        return;
      }
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
      case "chat.room.read": {
        const { room_id: roomId, user_id: userId } = msg.payload;
        if (viewer.userId) patchChatRoomRead(qc, wsId, viewer.userId, roomId, userId);
        // The reader's own pointer moved (here or on another device): the per-workspace counts follow, and the
        // room's notifications come down on this phone too.
        if (userId === viewer.userId) {
          schedule(chatKeys.unreadSummary());
          roomWasRead(roomId);
        }
        return;
      }
      case "chat.voice.hangup":
        // The hangup is published after the server wrote the call's log (SignalVoiceHangup).
        schedule(chatKeys.callLogs(wsId));
        return;
      case "chat.typing":
        if (viewer.userId) deps.typing.bump(msg.payload.room_id, msg.payload.user_id, viewer.userId);
        return;
      case "user.presence":
        if (viewer.userId) deps.presence.bump(msg.payload.user_id, viewer.userId);
        return;
      case "user.offline":
        deps.presence.markOffline(msg.payload.user_id);
        return;
      default:
        return;
    }
  }

  /**
   * Frames sent while the socket was down are gone: each cache refreshes its own keys (ADR 0011 §5).
   * A change log with GET /chat/sync?since=<seq> would make this one request; it waits on its ADR
   * (docs/adr/drafts/0039-dong-bo-chat-theo-nhat-ky-thay-doi.md) and is effort L.
   */
  function reconnect(): void {
    schedule(chatKeys.rooms(wsId), chatKeys.nicknames(wsId), chatKeys.members(wsId), chatKeys.callLogs(wsId), chatKeys.unreadSummary());
    void qc.invalidateQueries({ queryKey: chatKeys.threadsRoot(wsId) });
    refreshLoadedRoomTimelines(qc, wsId);
  }

  function dispose(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    scheduled.clear();
  }

  return { handle, reconnect, dispose };
}
