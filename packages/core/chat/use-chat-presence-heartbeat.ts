"use client";

import { useEffect } from "react";
import { signalChatPresence } from "../api/endpoints/chat";

const HEARTBEAT_MS = 15_000;

function beat(
  workspaceId: string,
  state: "online" | "offline",
  opts?: { keepalive?: boolean },
): void {
  // Presence is best-effort — never surface fetch failures as unhandled rejections.
  void signalChatPresence(workspaceId, state, opts).catch(() => undefined);
}

/** Keep the caller's online presence fresh while the hook is mounted (workspace shell). */
export function useChatPresenceHeartbeat(workspaceId: string, enabled = true): void {
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    let cancelled = false;

    const beatOnline = () => {
      if (cancelled) return;
      beat(workspaceId, "online");
    };

    beatOnline();
    const timer = window.setInterval(beatOnline, HEARTBEAT_MS);

    const onPageHide = () => {
      beat(workspaceId, "offline", { keepalive: true });
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
      beat(workspaceId, "offline");
    };
  }, [workspaceId, enabled]);
}
