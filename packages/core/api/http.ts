import { runtimeConfig } from "../runtime-config";
import { SessionResponseSchema, type SessionResponse } from "../types/user";
import { parseWithFallback } from "./schema";
import { getAccessToken, setAccessToken } from "./session";

/**
 * HTTP transport only: base URL, bearer header, one refresh-and-retry on 401,
 * and the structured error. It knows nothing about endpoints or their shapes —
 * that lives in ./endpoints, where every response goes through
 * parseWithFallback so a drifted contract degrades instead of throwing.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    /**
     * The correlation id of the failed request, echoed by the server. It is on
     * the error rather than only in a log line so an error screen can show the
     * one string support needs to find the whole chain.
     */
    public correlationId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The stable `code` a handler attaches to a failure, so a caller can render
 * its own localized sentence instead of the server's message. Undefined for a
 * non-ApiError, in which case the caller falls back to err.message.
 */
export function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError && err.code ? err.code : undefined;
}

/**
 * The correlation id of a failed request, for an error screen to show. It is
 * the one string that lets support find the request, the audit row it wrote
 * and every event it produced, so it belongs in front of the user rather than
 * only in a log they cannot read.
 */
export function correlationIdOf(err: unknown): string | undefined {
  return err instanceof ApiError ? err.correlationId : undefined;
}

/**
 * Human-readable message from a failed API call. Prefers the server's sentence
 * when the transport wrapped it in ApiError; otherwise falls back to a generic
 * Error's message.
 */
export function apiErrorMessage(err: unknown): string | undefined {
  if (err instanceof ApiError) {
    const message = err.message.trim();
    if (message) return message;
  }
  if (err instanceof Error) {
    const message = err.message.trim();
    if (message) return message;
  }
  return undefined;
}

export interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Skip the 401 → refresh → retry cycle. Used by the auth endpoints themselves. */
  skipRefresh?: boolean;
  /** Reuse a correlation id across several calls that are one user action. */
  correlationId?: string;
}

function baseUrl(): string {
  return runtimeConfig().apiUrl;
}

/**
 * The header that ties one user action to everything the server does about it.
 * The client mints the id so a support conversation can start from the
 * browser: the same value appears on the audit row, on every event the command
 * produced, and in the server's access log.
 *
 * The format is the one the server accepts as-is — `[A-Za-z0-9_-]{8,64}`.
 * Anything else is replaced server-side, which would break the trace, so this
 * generates rather than borrows.
 */
export const CORRELATION_HEADER = "X-Correlation-ID";

function newCorrelationId(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (random) return random;
  // Older browsers and non-DOM runtimes: any value in the accepted shape will
  // do, since the id only has to be unique enough to grep for.
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function rawFetch(path: string, opts: RequestOpts): Promise<Response> {
  const headers: Record<string, string> = { [CORRELATION_HEADER]: opts.correlationId ?? newCorrelationId() };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  return fetch(baseUrl() + path, {
    method: opts.method ?? "GET",
    headers,
    credentials: "include",
    body,
  });
}

/**
 * Perform a request and return the decoded JSON body as `unknown`. The type
 * is deliberately not parameterised: shaping the response is the endpoint's
 * job, through a schema, never a cast at the call site.
 */
export async function request(path: string, opts: RequestOpts = {}): Promise<unknown> {
  let res = await rawFetch(path, opts);
  if (res.status === 401 && !opts.skipRefresh && !path.startsWith("/api/v1/auth/")) {
    const refreshed = await refreshSession();
    if (refreshed) res = await rawFetch(path, opts);
  }
  if (!res.ok) {
    let code = "internal";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string } };
      if (body.error) ({ code, message } = body.error);
    } catch {
      /* body is not JSON */
    }
    throw new ApiError(message, code, res.status, res.headers.get(CORRELATION_HEADER) ?? undefined);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

/**
 * Like `request` but returns the body as text — for non-JSON downloads
 * (an .ics file) that still need the bearer token.
 */
export async function requestText(path: string): Promise<string> {
  let res = await rawFetch(path, {});
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) res = await rawFetch(path, {});
  }
  if (!res.ok) {
    throw new ApiError(res.statusText, "internal", res.status, res.headers.get(CORRELATION_HEADER) ?? undefined);
  }
  return res.text();
}

// Refresh tokens rotate: two refreshes racing (StrictMode double mount,
// several requests hitting 401 together) would have the second one present an
// already-revoked cookie → 401 → a spurious logout. Single-flight: every
// caller shares one in-flight promise.
let refreshInFlight: Promise<SessionResponse | null> | null = null;

/**
 * Obtain a new access token from the refresh cookie. Lives here rather than in
 * the auth endpoints because the transport's 401 retry depends on it.
 */
export function refreshSession(): Promise<SessionResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const raw = await request("/api/v1/auth/refresh", { method: "POST", skipRefresh: true });
      const sess = parseWithFallback<SessionResponse | null>(raw, SessionResponseSchema, null, {
        endpoint: "POST /api/v1/auth/refresh",
      });
      setAccessToken(sess?.access_token ?? null);
      return sess;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
