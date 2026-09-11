"use client";

import { useChatTypingSync } from "@uniwork/core/chat/use-chat-typing-sync";
import { useChatPresenceSync } from "@uniwork/core/chat/use-chat-presence-sync";
import { useChatPresenceHeartbeat } from "@uniwork/core/chat/use-chat-presence-heartbeat";
import { useChatRoomReadSync } from "@uniwork/core/chat/use-chat-room-read-sync";

/** Typing, presence heartbeat/sync, and DM read-receipt fan-in for the chat page. */
export function useChatPageSignals(
  workspaceId: string,
  currentUserId: string,
  authReady: boolean,
): void {
  useChatTypingSync(currentUserId);
  useChatPresenceSync(currentUserId);
  useChatPresenceHeartbeat(workspaceId, authReady);
  useChatRoomReadSync(workspaceId, currentUserId);
}
