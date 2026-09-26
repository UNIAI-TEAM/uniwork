// redirect.mjs — the one callback UniWork Office registers (DOC-005 §2).
// Node 22 built-ins only.
//
// Both halves of the flow import this constant instead of each spelling the
// string out, because the whole point of the rule is that the value is exact.
// UniWork Office and the retired GenOffice build must not be able to open each
// other's callback, so the server refuses any redirect but this one and the
// client refuses any callback that is not byte-identical to it.

/** The fixed desktop callback. No trailing slash, no query, no host variation. */
export const REDIRECT_URI = "uniwork-office://auth/callback";

/** Custom-scheme prefix of the GenOffice build that must NOT be accepted. */
export const FOREIGN_REDIRECT_URI = "genoffice://auth/callback";

/**
 * Parse a callback URL into the exact parts the client must check. Returns null
 * for anything that is not a custom-scheme URL, so a caller cannot pass an
 * http(s) URL and have it treated as "close enough".
 */
export function parseCallback(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)\??([^#]*)?#?(.*)$/i.exec(rawUrl);
  if (!schemeMatch) return null;
  const [, scheme, host, pathname, query] = schemeMatch;
  return {
    scheme,
    host,
    pathname: pathname || "",
    query: query || "",
    origin: scheme + "://" + host,
    code: new URLSearchParams(query || "").get("code"),
    state: new URLSearchParams(query || "").get("state"),
  };
}

/**
 * True only for the exact registered callback, compared as scheme+host+path so a
 * trailing slash, an extra path segment or a different scheme all fail.
 */
export function isRegisteredCallback(rawUrl) {
  const parsed = parseCallback(rawUrl);
  if (!parsed) return false;
  return parsed.scheme + "://" + parsed.host + parsed.pathname === REDIRECT_URI;
}
