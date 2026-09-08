"use client";

import { useEffect } from "react";
import { useOptionalWS } from "../realtime";
import { useSidebarTypingStore } from "./sidebar-typing-store";

/** Fan-in WS chat.typing events into the sidebar typing store. */
export function useChatTypingSync(currentUserId: string): void {
  const ws = useOptionalWS()?.client ?? null;
  const bump = useSidebarTypingStore((state) => state.bump);
  const clearAll = useSidebarTypingStore((state) => state.clearAll);

  useEffect(() => {
    if (!ws || !currentUserId) return;

    const off = ws.on("chat.typing", (payload) => {
      const data = payload as { room_id?: string; user_id?: string };
      if (!data.room_id || !data.user_id) return;
      bump(data.room_id, data.user_id, currentUserId);
    });

    return () => {
      off();
      clearAll();
    };
  }, [ws, currentUserId, bump, clearAll]);
}
