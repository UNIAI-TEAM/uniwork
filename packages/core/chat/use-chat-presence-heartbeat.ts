"use client";

import { useEffect } from "react";
import { signalChatPresence } from "../api/endpoints/chat";
import { beatChatPresence } from "../api/endpoints/chat-presence";
import { useAuthStore } from "../auth/store";
import { usePresenceStore } from "./presence-store";

const HEARTBEAT_MS = 15_000;

function leave(workspaceId: string, opts?: { keepalive?: boolean }): void {
  // Presence is best-effort — never surface fetch failures as unhandled rejections.
  void signalChatPresence(workspaceId, "offline", opts).catch(() => undefined);
}

/**
 * Keep the caller's online presence fresh while the hook is mounted
 * (workspace shell). The server announces only state changes, so each beat's
 * answer — who is online — is how this page learns about peers that were
 * online before it opened. A server without that answer keeps announcing
 * every beat, and the store's expiry handles it as before.
 */
export function useChatPresenceHeartbeat(workspaceId: string, enabled = true): void {
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    let cancelled = false;

    const beat = () => {
      if (cancelled) return;
      const sentAt = Date.now();
      void beatChatPresence(workspaceId)
        .then((online) => {
          const self = useAuthStore.getState().user?.id;
          if (cancelled || online === null || !self) return;
          usePresenceStore.getState().reconcile(online, self, sentAt);
        })
        .catch(() => undefined);
    };

    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);

    const onPageHide = () => {
      leave(workspaceId, { keepalive: true });
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
      leave(workspaceId);
    };
  }, [workspaceId, enabled]);
}
