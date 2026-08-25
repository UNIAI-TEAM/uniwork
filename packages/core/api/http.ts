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

export interface RequestOpts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Skip the 401 → refresh → retry cycle. Used by the auth endpoints themselves. */
  skipRefresh?: boolean;
}

function baseUrl(): string {
  return runtimeConfig().apiUrl;
}

async function rawFetch(path: string, opts: RequestOpts): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(baseUrl() + path, {
    method: opts.method ?? "GET",
    headers,
    credentials: "include",
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
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
    throw new ApiError(message, code, res.status);
  }
  if (res.status === 204) return undefined;
  return res.json();
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
