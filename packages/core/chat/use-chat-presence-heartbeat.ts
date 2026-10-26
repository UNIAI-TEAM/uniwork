"use client";

import { useEffect } from "react";
import { useAuthStore } from "../auth/store";
import { acquirePresenceHeartbeat } from "./presence-heartbeat-coordinator";
import { usePresenceStore } from "./presence-store";

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

    return acquirePresenceHeartbeat(workspaceId, (online, sentAt) => {
      const self = useAuthStore.getState().user?.id;
      if (online === null || !self) return;
      usePresenceStore.getState().reconcile(online, self, sentAt);
    });
  }, [workspaceId, enabled]);
}
