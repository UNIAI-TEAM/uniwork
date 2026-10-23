// The inbox row's swipe (components/chat/room-swipe.tsx), pure so the node
// tests hold it and marked as worklets so the gesture runs it on the UI thread.
// As in Mail, WhatsApp and Telegram: a swipe to the right past the threshold
// marks the room read when it is let go (a full swipe, nothing stays open); a
// swipe to the left reveals the row's buttons (pin, mute), which stay open
// once the drag passed half their width or flicked that way, and close
// otherwise.

/** One revealed button's width. */
export const ROOM_SWIPE_BUTTON = 76;
/** A rightward drag this far, let go, marks the room read. */
export const ROOM_SWIPE_READ = 80;
/** A flick this fast (pt/s) opens or closes the buttons from any distance. */
export const ROOM_SWIPE_FLICK = 600;

export interface RoomSwipeSides {
  /** The leading (rightward) swipe acts: the room has something unread. */
  leading: boolean;
  /** How many buttons the leftward swipe reveals. */
  trailing: number;
}

export type RoomSwipeRelease = "read" | "open" | "close";

/** Where the row sits: from where the drag began (0, or open at minus the buttons' width), never past either side. */
export function roomSwipeOffset(start: number, translationX: number, sides: RoomSwipeSides): number {
  "worklet";
  const most = sides.leading ? ROOM_SWIPE_READ : 0;
  const least = sides.trailing > 0 ? -sides.trailing * ROOM_SWIPE_BUTTON : 0;
  return Math.min(most, Math.max(least, start + translationX));
}

/** What letting go at `offset` with `velocityX` does. */
export function roomSwipeRelease(offset: number, velocityX: number, sides: RoomSwipeSides): RoomSwipeRelease {
  "worklet";
  if (sides.leading && offset >= ROOM_SWIPE_READ) return "read";
  if (sides.trailing === 0 || offset >= 0) return "close";
  if (velocityX < -ROOM_SWIPE_FLICK) return "open";
  if (velocityX > ROOM_SWIPE_FLICK) return "close";
  return offset <= -(sides.trailing * ROOM_SWIPE_BUTTON) / 2 ? "open" : "close";
}

/** Whether the drag at `offset` is past the point where letting go acts (the haptic tick's threshold). */
export function roomSwipeArmed(offset: number, sides: RoomSwipeSides): boolean {
  "worklet";
  if (offset > 0) return sides.leading && offset >= ROOM_SWIPE_READ;
  return sides.trailing > 0 && offset <= -(sides.trailing * ROOM_SWIPE_BUTTON) / 2;
}
