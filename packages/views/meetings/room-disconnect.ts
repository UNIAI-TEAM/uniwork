import { DisconnectReason } from "livekit-client";

export type MediaDisconnectKind = "connection" | "replaced";

/** User-visible disconnect cause for the meeting room media layer. */
export function mediaDisconnectKind(reason?: DisconnectReason): MediaDisconnectKind | null {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "replaced";
    case DisconnectReason.JOIN_FAILURE:
      return "connection";
    default:
      return null;
  }
}

/** Leave the UniWork room page only when the conference itself ended — not on a
 *  local disconnect. User Leave navigates via onLeave; React Strict Mode also
 *  disconnects during remount (CLIENT_INITIATED), which must not eject the page. */
export function shouldLeaveOnDisconnect(reason?: DisconnectReason): boolean {
  switch (reason) {
    case DisconnectReason.PARTICIPANT_REMOVED:
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return true;
    default:
      return false;
  }
}

/** Re-fetch a LiveKit credential only after an unexpected disconnect that a new token may fix. */
export function shouldRefreshCredentialOnDisconnect(reason?: DisconnectReason): boolean {
  if (shouldLeaveOnDisconnect(reason)) return false;
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
    case DisconnectReason.JOIN_FAILURE:
    case DisconnectReason.USER_REJECTED:
    case DisconnectReason.STATE_MISMATCH:
    case DisconnectReason.DUPLICATE_IDENTITY:
      return false;
    default:
      return true;
  }
}
