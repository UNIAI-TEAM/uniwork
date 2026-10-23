import type { QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord } from "../api/endpoints/chat";
import { chatKeys } from "./chat-keys";
import { pendingChatMessageId } from "./pending-message-id";
import {
  insertCreatedTimelineMessage,
  mapRoomTimeline,
  type RoomTimeline,
} from "./room-timeline-pages";

export type OutboundRoomMessageInput = {
  roomId: string;
  body?: string;
  client_msg_id?: string;
  reply_to_message_id?: string;
  priority?: "important" | "urgent";
};

let optimisticCreatedAtSeq = 0;

/** Strictly increasing timestamps so rapid sends stay ordered in the timeline. */
export function optimisticCreatedAtIso(): string {
  optimisticCreatedAtSeq += 1;
  return new Date(Date.now() + optimisticCreatedAtSeq).toISOString();
}

export function stripPendingFromTimeline(data: RoomTimeline, clientMsgId: string): RoomTimeline {
  const pendingId = pendingChatMessageId(clientMsgId);
  return mapRoomTimeline(data, (page) => page.filter((row) => row.id !== pendingId));
}

export function buildOptimisticRoomMessageRecord(
  workspaceId: string,
  input: OutboundRoomMessageInput,
  sender: { id: string; display_name: string },
): ChatMessageRecord | null {
  if (!input.client_msg_id || !input.body) return null;
  const createdAt = optimisticCreatedAtIso();
  return {
    id: pendingChatMessageId(input.client_msg_id),
    room_id: input.roomId,
    workspace_id: workspaceId,
    sender_id: sender.id,
    sender_display_name: sender.display_name,
    kind: "text",
    body: input.body,
    created_at: createdAt,
    cursor: `pending-${input.client_msg_id}`,
    client_msg_id: input.client_msg_id,
    reply_to_message_id: input.reply_to_message_id,
    pinned: false,
    mentioned_user_ids: [],
    reactions: {},
    reply_count: 0,
    thread_unread: false,
    priority: input.priority,
  };
}

/** Appends an outbound bubble to a loaded room timeline without refetching. */
export function insertOptimisticRoomMessageIfLoaded(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  message: ChatMessageRecord,
): boolean {
  const key = chatKeys.roomMessages(wsId, roomId);
  const existing = qc.getQueryData<RoomTimeline>(key);
  if (existing === undefined) return false;
  const next = insertCreatedTimelineMessage(existing, message);
  if (!next) return false;
  qc.setQueryData(key, next);
  return true;
}

export function removeOptimisticRoomMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  clientMsgId: string,
): void {
  const key = chatKeys.roomMessages(wsId, roomId);
  const existing = qc.getQueryData<RoomTimeline>(key);
  if (existing === undefined) return;
  const next = stripPendingFromTimeline(existing, clientMsgId);
  if (next !== existing) qc.setQueryData(key, next);
}

/** Swap the local pending row for the server's copy in one timeline patch. */
export function commitOptimisticRoomSend(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  clientMsgId: string,
  serverMessage: ChatMessageRecord,
): void {
  const key = chatKeys.roomMessages(wsId, roomId);
  const existing = qc.getQueryData<RoomTimeline>(key);
  if (existing === undefined) return;
  const withoutPending = stripPendingFromTimeline(existing, clientMsgId);
  const next = insertCreatedTimelineMessage(withoutPending, serverMessage);
  if (next) qc.setQueryData(key, next);
  else void qc.invalidateQueries({ queryKey: key });
}
