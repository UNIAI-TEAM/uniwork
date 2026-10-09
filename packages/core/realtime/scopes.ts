/** Realtime scope types the server accepts on subscribe frames. */
export const WS_SCOPE_CHAT = "chat" as const;
/**
 * A meeting held open by its room or detail page. In-room events (chat,
 * transcript, the roll, motions, recordings, the lobby queue) are delivered
 * only on this scope, not to the whole workspace.
 */
export const WS_SCOPE_MEETING = "meeting" as const;

/**
 * Backoff before asking again for a scope the server could not authorize
 * (`lookup_failed`: its database check timed out or failed). Without a retry
 * the screen would stay deaf to its own events until the socket reconnects,
 * which is exactly when the server is busiest.
 */
export const LOOKUP_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000] as const;

export function lookupRetryDelayMs(attempt: number): number {
  const base = LOOKUP_RETRY_DELAYS_MS[Math.min(attempt, LOOKUP_RETRY_DELAYS_MS.length - 1)] ?? 30_000;
  // ±20 % jitter so scopes that failed together do not retry together.
  return Math.round(base * (0.8 + Math.random() * 0.4));
}
