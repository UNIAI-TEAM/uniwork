"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOptionalWS } from "../realtime";
import { chatKeys } from "./chat-keys";

/** Refetch rooms when a peer bumps their read cursor (payload is ids only). */
export function useChatRoomReadSync(workspaceId: string, currentUserId: string): void {
  const ws = useOptionalWS()?.client ?? null;
  const qc = useQueryClient();

  useEffect(() => {
    if (!ws || !workspaceId || !currentUserId) return;

    const off = ws.on("chat.room.read", (payload) => {
      const data = payload as { room_id?: string; user_id?: string };
      if (!data.room_id || !data.user_id) return;
      if (data.user_id.toUpperCase() === currentUserId.toUpperCase()) return;
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    });

    return () => {
      off();
    };
  }, [ws, workspaceId, currentUserId, qc]);
}
