"use client";

import { useEffect } from "react";
import { usePendingChatMessagesStore } from "./pending-messages-store";
import { useChatSendOutboxStore } from "./send-outbox-store";

/**
 * Drop local send queues once the room history proves the send landed.
 *
 * The outbox is persisted, so an entry the sender queued after a network flake
 * survives reloads. Without this, a send that actually committed keeps a second
 * bubble on that one machine — the server row and the queued copy of it — and
 * the flush only runs on reconnect, which may never fire again in that session.
 */
export function useClearDeliveredChatSends(messages: { client_msg_id?: string }[]): void {
  useEffect(() => {
    const delivered = new Set<string>();
    for (const message of messages) {
      if (message.client_msg_id) delivered.add(message.client_msg_id);
    }
    if (delivered.size === 0) return;

    const outbox = useChatSendOutboxStore.getState();
    const pending = usePendingChatMessagesStore.getState();
    for (const clientMsgId of delivered) {
      if (outbox.entries.some((entry) => entry.client_msg_id === clientMsgId)) {
        outbox.remove(clientMsgId);
      }
      if (pending.entries.some((entry) => entry.client_msg_id === clientMsgId)) {
        pending.remove(clientMsgId);
      }
    }
  }, [messages]);
}
