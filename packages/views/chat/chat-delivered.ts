"use client";

import { createContext, useMemo } from "react";
import type { ChatRoomMemberRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { deliveredToAllAt } from "@uniwork/core/chat/read-receipt-utils";

/**
 * How far every other member of the open room has received it: own messages
 * up to it carry ✓✓ grey until seen (UNI-1908 F4), thread replies too, since
 * a device acks every message it hears. Null wherever nobody counts them.
 */
export const ChatPeerDeliveredAtContext = createContext<string | null>(null);

/**
 * The open room's delivered-to-everyone cursor from its member list: a DM's
 * peer, a group's or non-default channel's slowest member. Off in the
 * workspace's default room, whose members are the whole workspace.
 */
export function useChatDeliveredAt(
  room: Pick<ChatRoomRecord, "kind" | "is_default"> | undefined,
  members: readonly ChatRoomMemberRecord[],
  currentUserId: string,
): string | null {
  const enabled = room?.kind === "dm" || room?.kind === "group" || (room?.kind === "channel" && !room.is_default);
  return useMemo(() => (enabled ? deliveredToAllAt(members, currentUserId) : null), [currentUserId, enabled, members]);
}
