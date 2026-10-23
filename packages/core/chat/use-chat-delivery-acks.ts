"use client";

import { useEffect, useMemo } from "react";
import { ackChatDelivered } from "../api/endpoints/chat-delivery";
import { useOptionalWS } from "../realtime";
import { createChatDeliveryAcker } from "./chat-delivery-acker";
import { useChatRooms } from "./chat-hooks-rooms";

const sameUser = (a: string | undefined, b: string) => a?.toUpperCase() === b.toUpperCase();

/**
 * While the chat page is open, tells the server which rooms' messages this
 * device holds, so their senders see ✓✓ grey: on every message frame from
 * someone else, and for each room whose last message (from someone else) is
 * newer than the caller's read pointer when the room list loads or refreshes.
 */
export function useChatDeliveryAcks(workspaceId: string, currentUserId: string): void {
  const ws = useOptionalWS()?.client ?? null;
  const rooms = useChatRooms(workspaceId).data;
  const acker = useMemo(() => createChatDeliveryAcker((batch) => ackChatDelivered(workspaceId, batch)), [workspaceId]);

  useEffect(() => () => acker.dispose(), [acker]);

  useEffect(() => {
    if (!ws || !currentUserId) return;
    return ws.on("chat.message.created", (payload) => {
      const data = payload as { room_id?: string; sender_id?: string };
      if (data.room_id && !sameUser(data.sender_id, currentUserId)) acker.ack(data.room_id, Date.now());
    });
  }, [ws, currentUserId, acker]);

  useEffect(() => {
    if (!currentUserId) return;
    for (const room of rooms ?? []) {
      if (!room.last_message_at || sameUser(room.last_message_sender_id, currentUserId)) continue;
      const last = Date.parse(room.last_message_at);
      if (last > (room.last_read_at ? Date.parse(room.last_read_at) : Number.NEGATIVE_INFINITY)) acker.ack(room.id, last);
    }
  }, [rooms, currentUserId, acker]);
}
