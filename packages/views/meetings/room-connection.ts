import { ApiError } from "@uniwork/core/api";

/** Backoff steps for lobby join when WebSocket is unavailable (not a fixed 4s poll). */
const LOBBY_RETRY_DELAYS_MS = [10_000, 20_000, 30_000, 60_000] as const;

/** Every signal that ends a lobby wait: admitted, declined, or the meeting closing. */
const LOBBY_JOIN_WS_EVENTS = [
  "meeting.started",
  "meeting.ended",
  "meeting.canceled",
  "join_request.approved",
  "join_request.rejected",
  "conference.session_ready",
] as const;

/** Decisions on one join request: only the knocker it names needs to ask again. */
const JOIN_REQUEST_DECISION_EVENTS = ["join_request.approved", "join_request.rejected"] as const;

/** /join answers that mean "not now" rather than "no": rate limited, or overloaded. */
const RETRYABLE_JOIN_STATUSES = [429, 503] as const;

/** Upper bound on a server-sent Retry-After, so a bad header cannot strand the lobby. */
const MAX_RETRY_AFTER_SECONDS = 300;

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

/**
 * Whether a realtime frame should make this lobby ask /join again. A decision
 * on a join request wakes only its own knocker; without that, every approval
 * re-asked for every waiter (W waiters, ~W²/2 joins). A frame without
 * join_request_id (an older server mid-deploy), or a lobby that does not know
 * its own request id, still wakes, so nobody is left waiting.
 */
export function shouldTriggerLobbyJoin(
  eventType: string,
  payload: Record<string, string>,
  meetingId: string,
  ownJoinRequestId?: string,
): boolean {
  if (payload.meeting_id !== meetingId) return false;
  if (!(LOBBY_JOIN_WS_EVENTS as readonly string[]).includes(eventType)) return false;
  if (!(JOIN_REQUEST_DECISION_EVENTS as readonly string[]).includes(eventType)) return true;
  const requestId = payload.join_request_id;
  return !requestId || !ownJoinRequestId || requestId === ownJoinRequestId;
}

/**
 * A /join failure the lobby should wait out and retry, not show as final. A
 * 503 for a missing configuration (livekit_not_configured) does not fix
 * itself, so it stays on screen instead of hiding behind the waiting lobby.
 */
export function isRetryableJoinError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    (RETRYABLE_JOIN_STATUSES as readonly number[]).includes(err.status) &&
    !err.code.endsWith("_not_configured")
  );
}

function retryAfterSecondsOf(err: ApiError): number | undefined {
  const value = err.retryAfterSeconds;
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(value, MAX_RETRY_AFTER_SECONDS);
}

/**
 * Delay before re-asking /join after it failed, or null when the failure is
 * final. A 429/503 waits out the server's Retry-After plus jitter, so a whole
 * office behind one NAT does not come back in the same second; without the
 * header it follows the lobby backoff.
 */
export function joinErrorRetryDelayMs(err: unknown, attempt: number): number | null {
  if (!isRetryableJoinError(err)) return null;
  const retryAfter = retryAfterSecondsOf(err);
  if (retryAfter === undefined) return lobbyRetryDelayMs(attempt);
  return retryAfter * 1_000 + lobbyWsTriggerJitterMs();
}
