import { timingSafeEqual } from "node:crypto";
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

/** Windows/Linux deliver the callback as a command-line argument (cold start or second instance). */
export function extractAuthCallbackFromArgv(argv: readonly unknown[], scheme: string): string | null {
  for (const arg of argv) if (isAuthCallbackUrl(arg, scheme)) return arg;
  return null;
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

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
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

/**
 * Where a sign-in callback can enter the process: the cold-start argv
 * (Windows/Linux), `open-url` (macOS, possibly before app ready) and a second
 * instance's argv. A callback that arrives before the session is ready is held
 * (latest wins) and handed over by start(). Electron-free; index.ts binds the events.
 */
export interface AuthCallbackRouter {
  /** `open-url`: true when the URL is a sign-in callback (routed or held) */
  openUrl(url: unknown): boolean;
  /** `second-instance`: true when the argv carried a sign-in callback */
  secondInstance(argv: readonly unknown[]): boolean;
  /** routes from now on, starting with the held callback */
  start(route: (url: string) => void): void;
}

export function createAuthCallbackRouter(initialArgv: readonly unknown[], scheme: string): AuthCallbackRouter {
  let held = extractAuthCallbackFromArgv(initialArgv, scheme);
  let route: ((url: string) => void) | null = null;
  const deliver = (url: string | null): boolean => {
    if (!url) return false;
    if (route) route(url);
    else held = url;
    return true;
  };
  return {
    openUrl: (url) => deliver(isAuthCallbackUrl(url, scheme) ? url : null),
    secondInstance: (argv) => deliver(extractAuthCallbackFromArgv(argv, scheme)),
    start(next) {
      route = next;
      const first = held;
      held = null;
      if (first) next(first);
    },
  };
}
