"use client";

import { useOptionalWS } from "./provider";
import { useRealtimeSync } from "./use-realtime-sync";

/**
 * Keeps the workspace's queries fresh from the realtime socket. Kept under the
 * name every screen already calls; the connection itself now lives in
 * WSProvider (mounted by the workspace layout), and this hook only wires the
 * cache sync for `workspaceId`. Outside a provider it is a no-op.
 */
export function useWorkspaceEvents(workspaceId: string): void {
  const ws = useOptionalWS();
  useRealtimeSync(ws?.client ?? null, workspaceId);
}
