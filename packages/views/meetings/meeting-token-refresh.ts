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
