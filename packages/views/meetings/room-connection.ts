import { DisconnectReason } from "livekit-client";

/** Backoff steps for lobby join when WebSocket is unavailable (not a fixed 4s poll). */
const LOBBY_RETRY_DELAYS_MS = [10_000, 20_000, 30_000, 60_000] as const;

const LOBBY_JOIN_WS_EVENTS = [
  "meeting.started",
  "join_request.approved",
  "conference.session_ready",
] as const;

/** Max random delay before a WS-triggered lobby join retry (spreads burst load). */
const LOBBY_WS_TRIGGER_JITTER_MS = 3_000;

/** Random delay in [0, maxMs] for WS-driven join retries. */
export function lobbyWsTriggerJitterMs(maxMs: number = LOBBY_WS_TRIGGER_JITTER_MS): number {
  return Math.round(Math.random() * maxMs);
}

/** Delay before the next lobby join attempt when WS is down. */
export function lobbyRetryDelayMs(attempt: number): number {
  const base = LOBBY_RETRY_DELAYS_MS[Math.min(attempt, LOBBY_RETRY_DELAYS_MS.length - 1)] ?? 60_000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.round(Math.max(0, base + jitter));
}

export function isLobbyWaiting(decision: string | undefined): boolean {
  return decision === "WAITING_FOR_HOST" || decision === "WAITING_APPROVAL" || decision === "WAITING_FOR_PROVIDER";
}

export function shouldTriggerLobbyJoin(
  eventType: string,
  payload: Record<string, string>,
  meetingId: string,
): boolean {
  if (payload.meeting_id !== meetingId) return false;
  return (LOBBY_JOIN_WS_EVENTS as readonly string[]).includes(eventType);
}

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
