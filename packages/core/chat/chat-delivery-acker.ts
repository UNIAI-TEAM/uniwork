import { CHAT_DELIVERED_MAX_ROOMS, type ChatDeliveredRoom } from "../api/endpoints/chat-delivery";

const ACK_DEBOUNCE_MS = 1_000;

/**
 * Batches "this device holds room X" into one request a second (UNI-1908
 * F4). `ack(roomId, since)` asks for the room's messages up to at least
 * `since` (ms) to count as delivered; a room already acked that far is not
 * sent again. A failed send is dropped: the next frame or room list acks it.
 * shortcut: up_to is this device's clock at the flush (the server stops it
 * at its own now); a clock more than the debounce behind the server's
 * under-acks until the next ack. Upgrade if frames ever carry the message time.
 */
export function createChatDeliveryAcker(
  send: (rooms: ChatDeliveredRoom[]) => Promise<boolean>,
  debounceMs = ACK_DEBOUNCE_MS,
) {
  const acked = new Map<string, number>();
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    timer = null;
    const at = Date.now();
    const rooms = [...pending].map((room_id) => ({ room_id, up_to: new Date(at).toISOString() }));
    pending.clear();
    for (let i = 0; i < rooms.length; i += CHAT_DELIVERED_MAX_ROOMS) {
      const chunk = rooms.slice(i, i + CHAT_DELIVERED_MAX_ROOMS);
      const ok = await send(chunk).catch(() => false);
      if (ok) for (const room of chunk) acked.set(room.room_id, at);
    }
  };

  return {
    ack(roomId: string, since: number) {
      if (!roomId || (acked.get(roomId) ?? Number.NEGATIVE_INFINITY) >= since) return;
      pending.add(roomId);
      timer ??= setTimeout(() => void flush(), debounceMs);
    },
    dispose() {
      if (timer != null) clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}
