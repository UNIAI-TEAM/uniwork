"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./chat-keys";

/**
 * Ensures default workspace chat membership before trusting listRooms. A
 * parallel empty listRooms response used to stick in the cache until hard
 * reload; re-run whenever auth is lost and regained (client-side re-login).
 */
export function useSyncChatRoomsOnAuth(
  workspaceId: string,
  ensureRoom: { mutateAsync: () => Promise<unknown> },
): void {
  const authReady = useAuthStore((s) => s.status === "authed");
  const qc = useQueryClient();
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!authReady || !workspaceId) {
      syncedRef.current = false;
      return;
    }
    if (syncedRef.current) return;
    syncedRef.current = true;
    void ensureRoom.mutateAsync().finally(() => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    });
  }, [authReady, workspaceId, ensureRoom, qc]);
}
