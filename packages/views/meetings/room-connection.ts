import { DisconnectReason } from "livekit-client";

const TOKEN_REFRESH_LEAD_MS = 15_000;

/** Delay before re-calling join to mint a fresh LiveKit JWT. Null = do not schedule. */
export function tokenRefreshDelayMs(expiresAt: string | undefined, nowMs = Date.now()): number | null {
  if (!expiresAt) return null;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return null;
  return Math.max(0, expiry - nowMs - TOKEN_REFRESH_LEAD_MS);
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
