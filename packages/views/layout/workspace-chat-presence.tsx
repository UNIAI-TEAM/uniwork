"use client";

import { useChatPresenceHeartbeat } from "@uniwork/core/chat/use-chat-presence-heartbeat";
import { useChatPresenceSync } from "@uniwork/core/chat/use-chat-presence-sync";
import { useWorkspace } from "./workspace-context";

/** Online heartbeat + peer presence fan-in for the whole workspace shell. */
export function WorkspaceChatPresence() {
  const { workspace, user } = useWorkspace();
  useChatPresenceSync(user.id);
  useChatPresenceHeartbeat(workspace.id, true);
  return null;
}
