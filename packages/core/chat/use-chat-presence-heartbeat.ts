"use client";

import { useEffect } from "react";
import { signalChatPresence } from "../api/endpoints/chat";

const HEARTBEAT_MS = 15_000;

/** Keep the caller's online presence fresh while the chat page is mounted. */
export function useChatPresenceHeartbeat(workspaceId: string, enabled = true): void {
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    let cancelled = false;

    const beatOnline = () => {
      if (cancelled) return;
      void signalChatPresence(workspaceId, "online");
    };

    const beatOffline = (keepalive = false) => {
      void signalChatPresence(workspaceId, "offline", { keepalive });
    };

    beatOnline();
    const timer = window.setInterval(beatOnline, HEARTBEAT_MS);

    const onPageHide = () => {
      beatOffline(true);
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
      beatOffline();
    };
  }, [workspaceId, enabled]);
}
