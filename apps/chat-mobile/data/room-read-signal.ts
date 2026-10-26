// "This room was read" for whoever on the phone cares, today the notification
// tray (data/notification-tray.ts, wired at boot by data/app-startup.ts): a read
// on this phone (data/pending-ops.ts › markRoomRead: opening the room, reaching
// its newest message, Mark as read) or on another of the person's devices (the
// socket's chat.room.read for the viewer, data/realtime/chat-realtime.ts).
// One listener; no import, so the data modules that signal stay node-testable.
type RoomReadListener = (roomId: string) => void;

let listener: RoomReadListener | null = null;

/** Listens to every read from now on; returns the stop (which leaves a newer listener alone). */
export function onRoomRead(next: RoomReadListener): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}

export function roomWasRead(roomId: string): void {
  listener?.(roomId);
}
