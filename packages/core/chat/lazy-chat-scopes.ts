import type { ChatRoomRecord } from "../api/endpoints/chat";

/** Default cap on concurrent chat:{roomId} WS subscriptions per client. */
export const DEFAULT_CHAT_SCOPE_LIMIT = 25;

export function selectLazyChatScopeRoomIds({
  rooms,
  activeRoomId,
  maxSubscriptions = DEFAULT_CHAT_SCOPE_LIMIT,
}: {
  rooms: readonly ChatRoomRecord[];
  activeRoomId: string | null;
  maxSubscriptions?: number;
}): string[] {
  if (maxSubscriptions <= 0) return activeRoomId ? [activeRoomId] : [];

  const selected: string[] = [];
  const seen = new Set<string>();
  const add = (roomId: string | null | undefined) => {
    if (!roomId || seen.has(roomId) || selected.length >= maxSubscriptions) return;
    seen.add(roomId);
    selected.push(roomId);
  };

  add(activeRoomId);

  for (const room of rooms) {
    if (room.kind === "workspace") continue;
    if (room.unread_count > 0) add(room.id);
  }

  for (const room of rooms) {
    if (room.kind === "workspace") continue;
    add(room.id);
  }

  return selected;
}
