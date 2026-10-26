"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatRoomRecord } from "../api/endpoints/chat";
import { notificationKeys } from "../notifications/hooks";
import { useOptionalWS } from "../realtime";
import { patchRoomRead } from "./chat-cache-records";
import { chatKeys } from "./chat-keys";

/**
 * Keep sidebar unread + peer read receipts in sync with `chat.room.read`
 * (chat-cache-records.ts › patchRoomRead, shared with the phone). An own read
 * also closed the room's inbox row and moved the account's unread.
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
      const roomId = data.room_id;
      qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(workspaceId), (old) => patchRoomRead(old, roomId, isSelf));
      if (isSelf) {
        // The read also closed the room's inbox row server-side (UNI-1665).
        void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
        void qc.invalidateQueries({ queryKey: notificationKeys.lists() });
        void qc.invalidateQueries({ queryKey: chatKeys.unreadSummary() });
      }
    });

    return () => {
      off();
    };
  }, [ws, workspaceId, currentUserId, qc]);
}
