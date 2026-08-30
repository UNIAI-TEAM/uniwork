import { NotificationCountType, SyncState, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

type TimelineEvent = {
  getId: () => string | undefined;
  getType: () => string;
  getSender: () => string | undefined;
  getTs: () => number;
  getContent: () => { body?: unknown };
};

/** Matrix local/pending events use ~… — only $… ids are valid for read receipts. */
export function isServerMatrixEventId(eventId: string | undefined): boolean {
  return typeof eventId === "string" && eventId.startsWith("$");
}

function messageEventsFromOthers(room: Room, myMatrixUserId: string): TimelineEvent[] {
  return room
    .getLiveTimeline()
    .getEvents()
    .filter((ev) => {
      if (ev.getType() !== "m.room.message") return false;
      const body = ev.getContent().body;
      return typeof body === "string" && body.length > 0;
    })
    .filter((ev) => ev.getSender() !== myMatrixUserId);
}

function lastServerReadableEvent(room: Room): MatrixEvent | null {
  const events = room.getLiveTimeline().getEvents();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (!ev) continue;
    if (ev.getType() !== "m.room.message") continue;
    const body = ev.getContent().body;
    if (typeof body !== "string" || body.length === 0) continue;
    if (!isServerMatrixEventId(ev.getId())) continue;
    return ev;
  }
  return null;
}

/** Count unread messages using read receipts, with sync notification count as fallback. */
export function countUnreadMessagesInRoom(room: Room, myMatrixUserId: string): number {
  const fromSync = room.getUnreadNotificationCount(NotificationCountType.Total);
  const messageEvents = messageEventsFromOthers(room, myMatrixUserId);
  const readUpTo = room.getEventReadUpTo(myMatrixUserId);

  if (!readUpTo) {
    return Math.max(fromSync, messageEvents.length);
  }

  const readEvent = room.findEventById(readUpTo);
  if (!readEvent) {
    return Math.max(fromSync, messageEvents.length);
  }

  const readTs = readEvent.getTs();
  const afterReceipt = messageEvents.filter((ev) => ev.getTs() > readTs).length;
  return Math.max(fromSync, afterReceipt);
}

export function unreadCountForRoom(
  client: MatrixClient,
  roomId: string,
  myMatrixUserId: string,
): number {
  const room = client.getRoom(roomId);
  if (!room) return 0;
  return countUnreadMessagesInRoom(room, myMatrixUserId);
}

const SYNC_READY_STATES = new Set<SyncState>([SyncState.Prepared, SyncState.Syncing, SyncState.Catchup]);

export function canMarkRoomAsRead(client: MatrixClient, roomId: string): boolean {
  const syncState = client.getSyncState();
  if (syncState == null || !SYNC_READY_STATES.has(syncState)) return false;
  const room = client.getRoom(roomId);
  if (!room) return false;
  const membership = room.getMyMembership();
  if (membership !== "join" && membership !== "invite") return false;
  return lastServerReadableEvent(room) != null;
}

export async function markRoomAsRead(client: MatrixClient, roomId: string): Promise<void> {
  if (!canMarkRoomAsRead(client, roomId)) return;
  const room = client.getRoom(roomId);
  if (!room) return;

  if (room.getMyMembership() === "invite") {
    await client.joinRoom(roomId);
  }

  const lastReadable = lastServerReadableEvent(room);
  const eventId = lastReadable?.getId();
  if (!lastReadable || !eventId || !isServerMatrixEventId(eventId)) return;

  try {
    await client.setRoomReadMarkers(roomId, eventId, lastReadable);
  } catch {
    try {
      await client.sendReadReceipt(lastReadable);
    } catch {
      // Read receipts are best-effort; local echo ids must not surface as runtime errors.
    }
  }
}
