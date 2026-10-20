"use client";

import { useChatDeliveryAcks } from "@uniwork/core/chat/use-chat-delivery-acks";
import { useChatPresenceHeartbeat } from "@uniwork/core/chat/use-chat-presence-heartbeat";
import { useChatPresenceSync } from "@uniwork/core/chat/use-chat-presence-sync";
import { useWorkspace } from "./workspace-context";

/**
 * Online heartbeat, peer presence fan-in and delivery acks for the whole
 * workspace shell: a message reaches this device whatever page is open, so
 * the sender's ✓✓ must not wait for the chat page.
 */
export function WorkspaceChatPresence() {
  const { workspace, user } = useWorkspace();
  useChatPresenceSync(user.id);
  useChatPresenceHeartbeat(workspace.id, true);
  useChatDeliveryAcks(workspace.id, user.id);
  return null;
}
