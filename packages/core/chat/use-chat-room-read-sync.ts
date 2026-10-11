"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatRoomRecord } from "../api/endpoints/chat";
import { useOptionalWS } from "../realtime";
import { chatKeys } from "./chat-keys";

/**
 * Keep sidebar unread + peer read receipts in sync with `chat.room.read`.
 * Own reads clear the local badge immediately (ListRoomMessages already
 * advanced last_read_at server-side; ignoring self left a stuck unread).
 * Someone else's read changes nothing of mine but a DM's "Seen", so it is
 * patched locally: refetching the sidebar here cost every reader O(rooms)
 * queries per read (C3).
 */
/** The server sets the cursor to the room's latest message, which is our last_message_at. */
function withPeerRead(room: ChatRoomRecord): ChatRoomRecord {
  const readAt = room.last_message_at;
  if (room.kind !== "dm" || !readAt) return room;
  const prior = room.peer_last_read_at ? Date.parse(room.peer_last_read_at) : Number.NEGATIVE_INFINITY;
  if (Date.parse(readAt) <= prior) return room;
  return { ...room, peer_last_read_at: readAt };
}

export function useChatRoomReadSync(workspaceId: string, currentUserId: string): void {
  const ws = useOptionalWS()?.client ?? null;
  const qc = useQueryClient();

  useEffect(() => {
    if (!ws || !workspaceId || !currentUserId) return;

    const off = ws.on("chat.room.read", (payload) => {
      const data = payload as { room_id?: string; user_id?: string };
      if (!data.room_id || !data.user_id) return;
      const isSelf = data.user_id.toUpperCase() === currentUserId.toUpperCase();
      if (isSelf) {
        qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(workspaceId), (old) => {
          if (!old) return old;
          return old.map((room) =>
            room.id === data.room_id
              ? { ...room, unread_count: 0, mention_unread_count: 0 }
              : room,
          );
        });
        return;
      }
      qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(workspaceId), (old) =>
        old?.map((room) => (room.id === data.room_id ? withPeerRead(room) : room)),
      );
    });

    return () => {
      off();
    };
  }, [ws, workspaceId, currentUserId, qc]);
}
