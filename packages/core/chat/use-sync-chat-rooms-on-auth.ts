"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "../auth/store";

/**
 * Ensures default workspace chat membership before trusting listRooms. A
 * parallel empty listRooms response used to stick in the cache until hard
 * reload; re-run whenever auth is lost and regained (client-side re-login).
 * Sidebar refresh stays on the ensure mutation's onSuccess — not here.
 */
export function useSyncChatRoomsOnAuth(
  workspaceId: string,
  ensureRoom: { mutateAsync: () => Promise<unknown> },
): void {
  const authReady = useAuthStore((s) => s.status === "authed");
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!authReady || !workspaceId) {
      syncedRef.current = false;
      return;
    }
    if (syncedRef.current) return;
    syncedRef.current = true;
    void ensureRoom.mutateAsync().catch(() => undefined);
  }, [authReady, workspaceId, ensureRoom]);
}
