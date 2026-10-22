// What may leave the phone in a crash report or a log line. Ported from the
// idea of packages/core/analytics/redact-exception.ts (copied, not imported:
// that module is not on the mobile allowlist), and extended for what a phone
// carries: bearer and Expo push tokens, the custom-scheme callback with its
// PKCE code, and Sentry's event and breadcrumb shapes. Pure: no Sentry import,
// the shapes below are the slice of the SDK's types this code touches.

export const REDACTED = "[redacted]";

/** What an ApiError's value becomes: the server's words may echo a name or what someone typed. */
export const SERVER_MESSAGE = "[server message]";

// Order matters: tokens with a known prefix first, then URL queries (so a
// URL's host is kept), then emails, then whatever sits between double or
// typographic quotes (a name, a room or a task title an error message quotes;
// ASCII single quotes carry code, as in 'name' of undefined, and stay), then
// any long opaque run (JWTs, refresh tokens, PKCE codes, ULIDs).
const PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\bBearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`],
  [/ExponentPushToken\[[^\]]*\]/g, `ExponentPushToken[${REDACTED}]`],
  [/((?:https?|wss?|file|exp|uniworkchat(?:-dev)?):\/\/[^\s?#"']*)[?#][^\s"']*/gi, `$1?${REDACTED}`],
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, REDACTED],
  [/"[^"\n]+"/g, `"${REDACTED}"`],
  [/“[^”\n]+”/g, `“${REDACTED}”`],
  [/‘[^’\n]+’/g, `‘${REDACTED}’`],
  [/«[^»\n]+»/g, `«${REDACTED}»`],
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
  exception?: { values?: { type?: string; value?: string }[] };
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
 * (never email, name or IP). An ApiError's value is the server's own message,
 * which may echo what a person typed: it goes whole, and the report keeps the
 * status, code and endpoint as tags (data/report.ts). Types and stack frames
 * are code locations and stay as they are.
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  const out: E = { ...event, message: redactText(event.message) };
  if (event.exception?.values) {
    out.exception = {
      ...event.exception,
      values: event.exception.values.map((v) => ({ ...v, value: v.type === "ApiError" ? SERVER_MESSAGE : redactText(v.value) })),
    };
  }
  if (event.breadcrumbs) out.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  if (event.request) out.request = { url: redactText(event.request.url) };
  if (event.user) out.user = event.user.id === undefined ? {} : { id: event.user.id };
  if (event.extra) out.extra = redactData(event.extra);
  return out;
}

export interface ScrubbableTransaction extends ScrubbableEvent {
  spans?: { description?: string; data?: Record<string, unknown> }[];
}

/**
 * Sentry's beforeSendTransaction (app start, screen loads, requests as spans):
 * what scrubEvent does, and each span's description and data, where a fetch
 * span carries its URL (a search query, an id in the path).
 */
export function scrubTransaction<E extends ScrubbableTransaction>(event: E): E {
  const out = scrubEvent(event);
  if (event.spans) out.spans = event.spans.map((span) => ({ ...span, description: redactText(span.description), data: redactData(span.data) }));
  return out;
}

/**
 * A request as a route, for grouping reports: the method and the path without
 * its query, every segment that is not a lowercase route word (an id, a slug,
 * an encoded emoji) as {id}. "GET /api/v1/workspaces/01J…/chat/rooms" reads
 * "GET /api/v1/workspaces/{id}/chat/rooms": no id leaves the phone, and one
 * route's failures group together.
 */
export function endpointShape(method: string | undefined, path: string): string {
  const route = path
    .replace(/[?#].*$/, "")
    .split("/")
    .map((segment) => (segment === "" || /^[a-z][a-z0-9_-]*$/.test(segment) ? segment : "{id}"))
    .join("/");
  return `${(method ?? "GET").toUpperCase()} ${route}`;
}
