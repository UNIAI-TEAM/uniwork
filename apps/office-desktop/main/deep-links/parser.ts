/** The only URL shape the Office host accepts. The ticket is deliberately
 * opaque and is the one value that ever crosses this parser boundary. */
export const OFFICE_LAUNCH_SCHEME = "uniwork-office:";
export const OFFICE_LAUNCH_HOST = "open";
export const OFFICE_LAUNCH_PATH = "";
export const LAUNCH_TICKET_MAX_LENGTH = 192;
export const LAUNCH_TICKET_MIN_LENGTH = 39;

/** The `ticket_` issuer marker separates launch capabilities from PKCE login
 * values (`code`, `state`, `attempt`) before any exchange can be attempted. */
export const LAUNCH_TICKET_PATTERN = /^ticket_[A-Za-z0-9_-]{32,185}$/;

export type DeepLinkRejectReason =
  | "malformed_url"
  | "wrong_scheme"
  | "wrong_host"
  | "wrong_path"
  | "fragment_not_allowed"
  | "missing_ticket"
  | "duplicate_ticket"
  | "unexpected_parameter"
  | "oversized_ticket"
  | "invalid_ticket"
  | "login_code";

export type DeepLinkParseResult =
  | Readonly<{ ok: true; ticket: string }>
  | Readonly<{ ok: false; reason: DeepLinkRejectReason }>;

function reject(reason: DeepLinkRejectReason): DeepLinkParseResult {
  // Never include the source URL or ticket in a refusal. These values are
  // suitable for typed telemetry and user-facing recovery only.
  return { ok: false, reason };
}

/** Parse an untrusted argv/open-url value without returning any metadata.
 * `URLSearchParams` is iterated instead of using `get` so duplicate and
 * unknown parameters fail closed. */
export function parseOfficeDeepLink(value: unknown): DeepLinkParseResult {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return reject("malformed_url");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return reject("malformed_url");
  }

  if (url.protocol !== OFFICE_LAUNCH_SCHEME) return reject("wrong_scheme");
  if (url.hostname !== OFFICE_LAUNCH_HOST || url.username || url.password || url.port) return reject("wrong_host");
  // URL normalisation represents the canonical `://open?ticket=` path as an
  // empty pathname. A single slash is accepted as equivalent syntax; nested
  // or named paths remain refused.
  if (url.pathname !== OFFICE_LAUNCH_PATH && url.pathname !== "/") return reject("wrong_path");
  if (url.hash) return reject("fragment_not_allowed");

  const parameters = [...url.searchParams.entries()];
  if (parameters.length === 0) return reject("missing_ticket");
  const ticketValues = parameters.filter(([key]) => key === "ticket");
  if (ticketValues.length === 0) return reject("missing_ticket");
  if (ticketValues.length > 1) return reject("duplicate_ticket");
  if (parameters.some(([key]) => key !== "ticket")) return reject("unexpected_parameter");

  const ticket = ticketValues[0]?.[1] ?? "";
  if (ticket.length > LAUNCH_TICKET_MAX_LENGTH) return reject("oversized_ticket");
  if (/^(?:code|state|attempt)[_-]/i.test(ticket) || /^fake-code-/i.test(ticket)) return reject("login_code");
  if (ticket.length < LAUNCH_TICKET_MIN_LENGTH || !LAUNCH_TICKET_PATTERN.test(ticket)) return reject("invalid_ticket");
  return { ok: true, ticket };
}

/** Extract a candidate callback from Electron's cold-start argv. Arguments
 * are never returned to callers except as the parser's opaque ticket result. */
export function launchUrlFromArgv(argv: readonly unknown[]): string | undefined {
  for (const argument of argv) {
    if (typeof argument === "string" && argument.startsWith("uniwork-office://")) return argument;
  }
  return undefined;
}
