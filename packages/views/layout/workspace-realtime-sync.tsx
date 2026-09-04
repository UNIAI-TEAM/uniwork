"use client";

import { useWorkspaceEvents } from "@uniwork/core/realtime";
import { useWorkspaceId } from "./workspace-context";

/** Keeps workspace queries fresh from WS while any shell screen is mounted. */
export function WorkspaceRealtimeSync() {
  const workspaceId = useWorkspaceId();
  useWorkspaceEvents(workspaceId);
  return null;
}
