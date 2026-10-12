// Diagnostics scrubber: every console line and status text that reaches meta.json
// (which travels with the cloud reports) goes through `clip`, so a credential in
// any common form never leaves the box.

const SENSITIVE = "token|secret|password|passwd|pwd|api[_-]?key|apikey|authorization|cookie|session|ticket|credential|jwt";
const VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s"',;&]+)`;

// header and key rules run in this order: a scheme or cookie list is consumed whole before the generic key rule sees it
const RULES = [
  // JWT-shaped strings anywhere (header.payload[.signature])
  [/eyJ[\w-]{4,}\.[\w-]{2,}(?:\.[\w-]*)?/g, "<redacted>"],
  // Authorization: Bearer <tok> / Basic <b64> / any scheme: the whole header value goes
  [new RegExp(String.raw`\b((?:proxy-)?authorization)["']?\s*[:=]\s*["']?(?:(?:bearer|basic|digest|negotiate|token)\s+)?[^\s"',;&]+`, "gi"), "$1=<redacted>"],
  // Cookie / Set-Cookie: every name=value pair up to the end of the list
  [/\b((?:set-)?cookie)["']?\s*[:=]\s*["']?(?:[^\s;"']+=[^\s;"']*;?\s*)+/gi, "$1=<redacted>"],
  // any identifier that contains a sensitive word (access_token, refreshToken, x-api-key, client_secret...)
  [new RegExp(String.raw`([\w.-]*(?:${SENSITIVE})[\w.-]*)["']?\s*[:=]\s*${VALUE}`, "gi"), "$1=<redacted>"],
  // a bare word followed by its value, as the earlier scrubber did ("token abc")
  [/\b(token|ticket|secret|password|passwd|api[_-]?key)\s+\S+/gi, "$1=<redacted>"],
  // a standalone Bearer token; Basic only when the value looks like base64 credentials, so "Basic formatting" survives
  [/\bbearer\s+[\w.~+/=-]+/gi, "bearer=<redacted>"],
  [/\bbasic\s+(?=[A-Za-z0-9+/]*(?:[0-9=+/]|[a-z][A-Z]))[A-Za-z0-9+/]{12,}={0,2}/gi, "basic=<redacted>"],
];

export function redact(text) {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), String(text));
}

export const clip = (text, length) => redact(text).replace(/\s+/g, " ").trim().slice(0, length);
