/** When to schedule the next proactive LiveKit JWT refresh (ms from now). */
export function proactiveTokenRefreshDelayMs(
  expiresAtIso: string | undefined,
  nowMs = Date.now(),
): number | null {
  if (!expiresAtIso) return null;
  const expires = Date.parse(expiresAtIso);
  if (!Number.isFinite(expires)) return null;
  const remaining = expires - nowMs;
  if (remaining <= 15_000) return null;
  // Refresh well before expiry without hammering /join: 20% of TTL or 90s, min 15s lead.
  const lead = Math.min(90_000, Math.max(15_000, remaining * 0.2));
  const delay = remaining - lead;
  return delay > 0 ? delay : null;
}

const REFRESH_RETRY_MS = 15_000;
const REFRESH_RETRY_FLOOR_MS = 5_000;

/**
 * When to try again after a failed refresh: every 15s while the current token
 * still has more than 5s left, instead of waiting for the next scheduled lead
 * (which, close to expiry, is none at all).
 */
export function tokenRefreshRetryDelayMs(expiresAtIso: string | undefined, nowMs = Date.now()): number | null {
  if (!expiresAtIso) return null;
  const expires = Date.parse(expiresAtIso);
  if (!Number.isFinite(expires)) return null;
  const remaining = expires - nowMs - REFRESH_RETRY_FLOOR_MS;
  if (remaining <= 0) return null;
  return Math.min(REFRESH_RETRY_MS, remaining);
}
