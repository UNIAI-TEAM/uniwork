"use client";

import { useEffect } from "react";
import { useOptionalWS } from "../realtime";
import { usePresenceStore } from "./presence-store";

const PRUNE_MS = 2_000;

/** Fan-in WS user.presence / user.offline into the presence store. */
export function useChatPresenceSync(currentUserId: string): void {
  const ws = useOptionalWS()?.client ?? null;
  const bump = usePresenceStore((state) => state.bump);
  const markOffline = usePresenceStore((state) => state.markOffline);
  const prune = usePresenceStore((state) => state.prune);
  const clearAll = usePresenceStore((state) => state.clearAll);

  useEffect(() => {
    if (!ws || !currentUserId) return;

    const offPresence = ws.on("user.presence", (payload) => {
      const data = payload as { user_id?: string };
      if (!data.user_id) return;
      bump(data.user_id, currentUserId);
    });

    const offOffline = ws.on("user.offline", (payload) => {
      const data = payload as { user_id?: string };
      if (!data.user_id) return;
      markOffline(data.user_id);
    });

    const timer = window.setInterval(() => {
      prune();
    }, PRUNE_MS);

    return () => {
      window.clearInterval(timer);
      offPresence();
      offOffline();
      clearAll();
    };
  }, [ws, currentUserId, bump, markOffline, prune, clearAll]);
}
