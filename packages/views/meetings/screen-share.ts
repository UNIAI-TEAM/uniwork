import type { Room } from "livekit-client";

/**
 * Whether this browser can capture a screen at all. Phone browsers (iOS
 * Safari, Chrome on Android) have no getDisplayMedia, so the control would
 * only ever fail there.
 */
export function screenShareSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/**
 * The i18n key for a failed start, or null when the person simply closed the
 * picker. Chrome reports both a cancel and an OS-level block as
 * NotAllowedError; only the block says "system".
 */
export function screenShareErrorKey(error: Error): string | null {
  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return /system/i.test(error.message) ? "meetings.shareBlockedBySystem" : null;
    case "NotSupportedError":
    case "TypeError":
      return "meetings.shareUnsupported";
    default:
      return "meetings.shareFailed";
  }
}

// Rooms whose next screen-share stop came from our own controls. A stop that
// did not (the browser's own bar, the OS, a dropped connection) is announced.
const stopsByUser = new WeakSet<Room>();

export function markScreenShareStopByUser(room: Room): void {
  stopsByUser.add(room);
}

export function takeScreenShareStopByUser(room: Room): boolean {
  const byUser = stopsByUser.has(room);
  stopsByUser.delete(room);
  return byUser;
}
