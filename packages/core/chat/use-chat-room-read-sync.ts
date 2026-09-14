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
 */
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
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    });

    return () => {
      off();
    };
  }, [ws, workspaceId, currentUserId, qc]);
}
