"use client";

import { useChatTypingSync } from "@uniwork/core/chat/use-chat-typing-sync";
import { useChatRoomReadSync } from "@uniwork/core/chat/use-chat-room-read-sync";

/** Typing and DM read-receipt fan-in while the chat page is mounted. Presence runs in the workspace shell. */
export function useChatPageSignals(
  workspaceId: string,
  currentUserId: string,
  _authReady: boolean,
): void {
  useChatTypingSync(currentUserId);
  useChatRoomReadSync(workspaceId, currentUserId);
}
