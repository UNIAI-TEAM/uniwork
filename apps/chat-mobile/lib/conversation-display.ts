// How a conversation screen draws runs of bubbles and its header mark (canvas
// MobileChat / MobThread): the corners of a bubble by its place in a run of one
// sender's bubbles, which rows continue into the next one, and the room's mark.
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isDefaultWorkspaceChannel } from "@uniwork/core/chat/chat-room-helpers";
import type { RoomMark } from "./room-list";
import type { TimelineRow } from "./timeline-display";

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

/** The mark in a conversation's header, as the room's list row draws it (lib/room-list.ts › buildRoomList). */
export function roomHeaderMark(room: ChatRoomRecord, title: string, online: boolean): RoomMark {
  if (isDefaultWorkspaceChannel(room)) return { kind: "workspace" };
  switch (room.kind) {
    case "dm":
      return room.peer_user_id ? { kind: "dm", label: title, online, userId: room.peer_user_id } : { kind: "dm", label: title, online };
    case "channel":
      return { kind: room.visibility === "private" ? "private-channel" : "channel" };
    default:
      return title ? { kind: "group", label: title } : { kind: "group" };
  }
}
