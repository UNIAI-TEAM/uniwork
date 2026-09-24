import { runtimeConfig } from "../runtime-config";
import { SessionResponseSchema, type SessionResponse } from "../types/user";
import { parseWithFallback } from "./schema";
import { getAccessToken, setAccessToken } from "./session";
import { GUEST_SESSION_HEADER, getGuestSession } from "./guest-session";

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
    /**
     * Machine-readable detail from ErrorSDO.fields (quota meters, duplicate
     * task refs, …). Optional; absent when the server sent none or the body
     * could not be parsed.
     */
    public fields?: Record<string, unknown>,
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
 * Machine-readable ErrorSDO.fields from a failed API call, when present.
 */
export function errorFields(err: unknown): Record<string, unknown> | undefined {
  return err instanceof ApiError ? err.fields : undefined;
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
  /**
   * Extra request headers (Idempotency-Key, If-Match, …). Authorization and
   * Content-Type are still owned by the transport.
   */
  headers?: Record<string, string>;
  /** Keep the request alive across page unload (presence offline, etc.). */
  keepalive?: boolean;
  /** Aborts the request, e.g. the `signal` TanStack hands a query function it may cancel. */
  signal?: AbortSignal;
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
  const headers: Record<string, string> = {
    [CORRELATION_HEADER]: opts.correlationId ?? newCorrelationId(),
    ...opts.headers,
  };
  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    const guest = getGuestSession();
    if (guest) headers[GUEST_SESSION_HEADER] = guest;
  }

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
    keepalive: opts.keepalive,
    signal: opts.signal,
  });
}

async function throwFromFailedResponse(res: Response): Promise<never> {
  let code = "internal";
  let message = res.statusText;
  let fields: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code: string; message: string; fields?: Record<string, unknown> };
    };
    if (body.error) {
      ({ code, message } = body.error);
      if (body.error.fields && typeof body.error.fields === "object" && !Array.isArray(body.error.fields)) {
        fields = body.error.fields;
      }
    }
  } catch {
    /* body is not JSON */
  }
  throw new ApiError(message, code, res.status, res.headers.get(CORRELATION_HEADER) ?? undefined, fields);
}

/**
 * Perform a request and return the decoded JSON body as `unknown`. The type
 * is deliberately not parameterised: shaping the response is the endpoint's
 * job, through a schema, never a cast at the call site.
 */
export async function request(path: string, opts: RequestOpts = {}): Promise<unknown> {
  let res = await rawFetch(path, opts);
  if (res.status === 401 && !opts.skipRefresh && !path.startsWith("/api/v1/auth/") && getAccessToken()) {
    const refreshed = await refreshSession();
    if (refreshed) res = await rawFetch(path, opts);
  }
  if (!res.ok) {
    await throwFromFailedResponse(res);
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
  if (res.status === 401 && getAccessToken()) {
    const refreshed = await refreshSession();
    if (refreshed) res = await rawFetch(path, {});
  }
  if (!res.ok) {
    throw new ApiError(res.statusText, "internal", res.status, res.headers.get(CORRELATION_HEADER) ?? undefined);
  }
  return res.text();
}

/**
 * Fetch an authenticated binary response. Native media elements cannot attach
 * the bearer token, so callers create a short-lived object URL from this blob.
 */
export async function requestBlob(path: string, opts: Pick<RequestOpts, "signal"> = {}): Promise<Blob> {
  let res = await rawFetch(path, opts);
  if (res.status === 401 && getAccessToken()) {
    const refreshed = await refreshSession();
    if (refreshed) res = await rawFetch(path, opts);
  }
  if (!res.ok) {
    await throwFromFailedResponse(res);
  }
  // Prefer arrayBuffer → Blob: jsdom's Response.blob() yields a Blob without
  // readable bytes / .text(), which breaks authenticated media object URLs in tests.
  const type = res.headers.get("Content-Type") ?? "";
  const buffer = await res.arrayBuffer();
  return new Blob([buffer], { type });
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
    const tokenBefore = getAccessToken();
    try {
      const raw = await request("/api/v1/auth/refresh", { method: "POST", skipRefresh: true });
      const sess = parseWithFallback<SessionResponse | null>(raw, SessionResponseSchema, null, {
        endpoint: "POST /api/v1/auth/refresh",
      });
      // Login/register may set a newer token while this refresh was in flight.
      const tokenNow = getAccessToken();
      if (tokenNow !== null && tokenNow !== tokenBefore) {
        return sess;
      }
      setAccessToken(sess?.access_token ?? null);
      return sess;
    } catch {
      // Do not wipe a token that arrived (e.g. login) after this call started.
      if (getAccessToken() === tokenBefore) {
        setAccessToken(null);
      }
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
