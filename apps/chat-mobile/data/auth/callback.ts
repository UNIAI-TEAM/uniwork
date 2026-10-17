// Ported from apps/chat-desktop/src/main/auth/callback.ts without the argv /
// second-instance router (Electron only): on a phone the callback URL comes
// back from WebBrowser.openAuthSessionAsync or a deep link.
import type { PendingLoginAttempt } from "./pkce";

/** the URL up to its query or fragment */
function baseOf(url: string): string {
  const end = url.search(/[?#]/);
  return end < 0 ? url : url.slice(0, end);
}

/** `<scheme>://auth/callback[?…]`; the OS may upper-case the scheme, validation compares exactly */
export function isAuthCallbackUrl(url: unknown, scheme: string): url is string {
  return typeof url === "string" && baseOf(url).toLowerCase() === `${scheme}://auth/callback`;
}

type CallbackRejectReason =
  | "no_attempt"
  | "expired"
  | "malformed"
  | "wrong_redirect"
  | "duplicate_query"
  | "unexpected_query"
  | "missing_param"
  | "state_mismatch";

export type CallbackValidation = { ok: true; code: string } | { ok: false; reason: CallbackRejectReason };

/** constant-time over the characters once the lengths match (no node:crypto on Hermes) */
function equalSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/**
 * Validates the custom-scheme callback before any exchange call: exact
 * redirect base, a query holding only `code` and `state` once each, no
 * fragment, and a constant-time state comparison. Never returns or logs the
 * URL, code or state on rejection.
 */
export function validateCallback(
  callbackUrl: string,
  attempt: PendingLoginAttempt | undefined,
  now: number,
): CallbackValidation {
  if (!attempt) return { ok: false, reason: "no_attempt" };
  if (attempt.expiresAt <= now) return { ok: false, reason: "expired" };
  if (callbackUrl.includes("#")) return { ok: false, reason: "malformed" };
  const queryStart = callbackUrl.indexOf("?");
  const base = queryStart < 0 ? callbackUrl : callbackUrl.slice(0, queryStart);
  if (base !== attempt.redirectUri) return { ok: false, reason: "wrong_redirect" };
  if (queryStart < 0) return { ok: false, reason: "missing_param" };
  const params = new URLSearchParams(callbackUrl.slice(queryStart + 1));
  const seen = new Set<string>();
  for (const [key] of params) {
    if (seen.has(key)) return { ok: false, reason: "duplicate_query" };
    seen.add(key);
    if (key !== "code" && key !== "state") return { ok: false, reason: "unexpected_query" };
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return { ok: false, reason: "missing_param" };
  if (!equalSecret(state, attempt.state)) return { ok: false, reason: "state_mismatch" };
  return { ok: true, code };
}
