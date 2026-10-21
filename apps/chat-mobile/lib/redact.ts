// What may leave the phone in a crash report or a log line. Ported from the
// idea of packages/core/analytics/redact-exception.ts (copied, not imported:
// that module is not on the mobile allowlist), and extended for what a phone
// carries: bearer and Expo push tokens, the custom-scheme callback with its
// PKCE code, and Sentry's event and breadcrumb shapes. Pure: no Sentry import,
// the shapes below are the slice of the SDK's types this code touches.

export const REDACTED = "[redacted]";

// Order matters: tokens with a known prefix first, then URL queries (so a
// URL's host is kept), then emails, then any long opaque run (JWTs, refresh
// tokens, PKCE codes, ULIDs).
const PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\bBearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`],
  [/ExponentPushToken\[[^\]]*\]/g, `ExponentPushToken[${REDACTED}]`],
  [/((?:https?|wss?|file|exp|uniworkchat(?:-dev)?):\/\/[^\s?#"']*)[?#][^\s"']*/gi, `$1?${REDACTED}`],
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, REDACTED],
  [/\b[A-Za-z0-9_-]{24,}\b/g, REDACTED],
];

/** The text with every token-, URL-query- and email-shaped part replaced; anything else as given. */
export function redactText<T>(input: T): T | string {
  if (typeof input !== "string" || input.length === 0) return input;
  let out: string = input;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** A log/breadcrumb payload, one level deep: strings redacted, numbers and booleans kept, the rest named only by type. */
export function redactData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") out[key] = redactText(value);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
    else out[key] = `[${Array.isArray(value) ? "array" : typeof value}]`;
  }
  return out;
}

export interface ScrubbableBreadcrumb {
  message?: string;
  data?: Record<string, unknown>;
}

export interface ScrubbableEvent {
  message?: string;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: ScrubbableBreadcrumb[];
  request?: { url?: string; query_string?: unknown; cookies?: unknown; headers?: Record<string, string>; data?: unknown };
  user?: { id?: string | number; [key: string]: unknown };
  extra?: Record<string, unknown>;
}

/** Sentry's beforeBreadcrumb: the message and the data (fetch URLs included) lose their sensitive parts. */
export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(breadcrumb: B): B {
  return { ...breadcrumb, message: redactText(breadcrumb.message), data: redactData(breadcrumb.data) };
}

/**
 * Sentry's beforeSend: messages, exception values, breadcrumbs, the request
 * and extra lose their sensitive parts; the user keeps only the opaque id
 * (never email, name or IP). Types and stack frames are code locations and
 * stay as they are.
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  const out: E = { ...event, message: redactText(event.message) };
  if (event.exception?.values) {
    out.exception = { ...event.exception, values: event.exception.values.map((v) => ({ ...v, value: redactText(v.value) })) };
  }
  if (event.breadcrumbs) out.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  if (event.request) out.request = { url: redactText(event.request.url) };
  if (event.user) out.user = event.user.id === undefined ? {} : { id: event.user.id };
  if (event.extra) out.extra = redactData(event.extra);
  return out;
}
