// The "read elsewhere" push (server notification/push_expo.go › roomReadMessage): a person read a room on some
// device, so this Android phone takes the room's message notifications out of the tray and sets its icon's count,
// even while UniChat is closed. Data-only, ids and a count only; every value a string, read leniently.
import { asRecord } from "./unknown-shape";

export interface RoomReadPush {
  roomId: string;
  workspaceId: string;
  /** Everything still unread, for the icon; null when the server did not say. */
  badge: number | null;
}

/** The room-read push in a push's data, or null when it is none. */
export function roomReadPushFromData(value: unknown): RoomReadPush | null {
  const data = asRecord(value);
  if (!data || data.type !== "room_read" || typeof data.room_id !== "string" || !data.room_id) return null;
  const badge = typeof data.badge === "string" && /^\d+$/.test(data.badge) ? Number(data.badge) : null;
  return { roomId: data.room_id, workspaceId: typeof data.workspace_id === "string" ? data.workspace_id : "", badge };
}
