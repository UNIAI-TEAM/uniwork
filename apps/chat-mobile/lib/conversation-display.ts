// How a conversation screen draws runs of bubbles and its header mark (canvas
// MobileChat / MobThread): the corners of a bubble by its place in a run of one
// sender's bubbles, which rows continue into the next one, and the room's mark.
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import type { RoomMark } from "./room-list";
import type { TimelineRow } from "./timeline-display";

/** Horizontal inset for message rows (parity `CHAT_CONVERSATION_GUTTER` on web). */
export const CHAT_CONVERSATION_ROW_INSET = "px-3";

/** Max bubble width on screen — web uses 85% on coarse/mobile (`chat-message-row.tsx`). */
export const CHAT_BUBBLE_MAX_WIDTH_CLASS = "max-w-[85%]";

/** 18 outside, 6 where a bubble joins the one above or below, 4 on the tail of a run's last bubble. */
export function bubbleCorners(own: boolean, first: boolean, last: boolean) {
  const top = first ? 18 : 6;
  const bottom = last ? 4 : 6;
  return own
    ? { borderTopLeftRadius: 18, borderTopRightRadius: top, borderBottomRightRadius: bottom, borderBottomLeftRadius: 18 }
    : { borderTopLeftRadius: top, borderTopRightRadius: 18, borderBottomRightRadius: 18, borderBottomLeftRadius: bottom };
}

/** The message rows the next row continues (same sender, close in time): not the last of their run. */
export function continuedRunKeys(rows: readonly TimelineRow[]): Set<string> {
  const keys = new Set<string>();
  rows.forEach((row, index) => {
    const next = rows[index + 1];
    if (row.type === "message" && next?.type === "message" && next.compactTop) keys.add(row.key);
  });
  return keys;
}

/**
 * The mark in a conversation's header and details, as the room's list row
 * draws it (lib/room-list.ts › buildRoomList): a person, the workspace's own
 * room, a channel (locked when private) or a group. A room still loading reads
 * as a group named by its title.
 */
export function roomHeaderMark(room: ChatRoomRecord | null, title: string, online: boolean): RoomMark {
  if (room && (room.kind === "workspace" || isDefaultWorkspaceChannel(room))) return { kind: "workspace" };
  switch (room?.kind) {
    case "dm":
      return room.peer_user_id ? { kind: "dm", label: title, online, userId: room.peer_user_id } : { kind: "dm", label: title, online };
    case "channel":
      return { kind: room.visibility === "private" ? "private-channel" : "channel" };
    default:
      return title ? { kind: "group", label: title } : { kind: "group" };
  }
}

/** Whether a room offers a call: a DM, a group or a channel, never the workspace's own room, and only with calls switched on. */
export function canCallRoom(room: ChatRoomRecord | null, callsOn: boolean): boolean {
  return callsOn && room !== null && (room.kind === "dm" || room.kind === "group" || room.kind === "channel") && !isDefaultWorkspaceChannel(room);
}

/** Pins, notes and polls among the messages a room has loaded (its details' "kept" rows). */
export function keptCounts(messages: readonly Pick<ChatMessageRecord, "pinned" | "kind">[]): { pins: number; notes: number; polls: number } {
  let pins = 0;
  let notes = 0;
  let polls = 0;
  for (const message of messages) {
    if (message.pinned) pins += 1;
    if (message.kind === "note") notes += 1;
    if (message.kind === "poll") polls += 1;
  }
  return { pins, notes, polls };
}
