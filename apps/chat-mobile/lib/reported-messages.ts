// The messages this person reported, hidden from them at once (Apple 1.2: the reporter stops seeing what they
// reported while the operator reviews it; WhatsApp and Telegram do the same). Kept on the device by
// data/stores/reported-messages-store.ts; this is the pure part: reading a kept record back and adding one.

/** How many reported messages a phone remembers; past it the oldest report is forgotten (and its message shows again). */
export const REPORTED_MESSAGES_MAX = 500;

/** A kept record read back: message id → when it was reported (ms). Anything else on disk is dropped, not trusted. */
export function readReportedMessages(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(value)) {
    if (id !== "" && typeof at === "number" && Number.isFinite(at)) out[id] = at;
  }
  return capReported(out);
}

/** The newest REPORTED_MESSAGES_MAX reports. */
function capReported(reported: Record<string, number>): Record<string, number> {
  const entries = Object.entries(reported);
  if (entries.length <= REPORTED_MESSAGES_MAX) return reported;
  return Object.fromEntries(entries.sort(([, a], [, b]) => b - a).slice(0, REPORTED_MESSAGES_MAX));
}

/** `reported` with one more message, reported at `at`. */
export function rememberReported(reported: Record<string, number>, messageId: string, at: number): Record<string, number> {
  return capReported({ ...reported, [messageId]: at });
}
