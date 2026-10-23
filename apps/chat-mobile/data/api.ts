// Ported from usf apps/mobile/data/api.ts (ApiError, the 30 s manual timeout,
// X-Request-ID, fetchValidated). The bearer comes from the native session and
// a 401 refreshes it once before it counts; X-Workspace-Slug is gone because
// UniWork scopes by the workspace id in the path.
import { parseWithFallback } from "@uniwork/core/api/schema";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import type { PushSubscriptionBody } from "@uniwork/core/types/notification";
import type { User } from "@uniwork/core/types/user";
import type { Workspace } from "@uniwork/core/types/workspace";
import type { ZodType } from "zod";
import { endpointShape } from "@/lib/redact";
import { issuePaths, SchemaMismatchError } from "@/lib/schema-mismatch";
import { session } from "./auth/flow";
import type { FetchLike } from "./auth/transport";
import { MeResponseSchema, WorkspacesResponseSchema } from "./schemas";

/**
 * Hard ceiling for every request: iOS may suspend a backgrounded network task
 * without ever settling the JS fetch promise, which would leave a query stuck
 * in isRefetching forever. Hermes has neither AbortSignal.timeout() nor
 * AbortSignal.any(), so one controller is composed by hand below.
 */
const FETCH_TIMEOUT_MS = 30_000;
/** A multipart upload (a chat photo or file, up to 25 MB) on a slow mobile link. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;
  /** A numeric Retry-After, so a send retry waits out the window instead of guessing. */
  readonly retryAfterSeconds?: number;
  /** The route that answered, ids as {id} (lib/redact.ts › endpointShape): crash reports group by it. */
  readonly endpoint?: string;
  constructor(message: string, status: number, body?: unknown, retryAfterSeconds?: number, endpoint?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
    this.endpoint = endpoint;
  }
}

/** the slice of MobileSession the client needs */
interface ApiSession {
  getAccessToken(): Promise<string | null>;
  refresh(): Promise<string | null>;
  status(): string;
}

interface ApiClientDeps {
  session: ApiSession;
  /**
   * Called once when a request is still 401 after one refresh, or the refresh
   * left the session signed out; re-armed by the next successful request. The
   * app wires it to its sign-out so stale requests do not loop on 401.
   */
  onUnauthorized?: () => void;
}

interface Opts {
  signal?: AbortSignal;
}

/**
 * the Expo push token goes in `endpoint`; `platform` is required for it, and
 * `call_ui` says an Android build draws its own incoming call, `chat_quiet` that it has the quiet chat channel
 * (server SDI)
 */
export type PushSubscription = PushSubscriptionBody & { platform: string; call_ui?: boolean; chat_quiet?: boolean };

const createRequestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function messageOf(body: unknown, res: Response): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message : `${res.status} ${res.statusText}`;
}

export function createApiClient(deps: ApiClientDeps) {
  let onUnauthorized = deps.onUnauthorized;
  let unauthorizedReported = false;
  // The fetch a JSON request goes through: the global one until the boot hands over data/auth/strict-fetch.ts, which
  // makes the native stack honour redirect: "error" (React Native's own ignores it). A multipart body always takes
  // the global fetch, the only one that sends React Native's { uri } file parts; there the platform decides whether
  // a cross-host redirect keeps the Authorization header (OkHttp drops it).
  let credentialFetch: FetchLike = (input, init) => fetch(input, init);
  // X-Client-Version / -OS / -Update-Id (lib/build-info.ts › clientHeaders),
  // set once at boot: the server logs and gates by them.
  let identity: Record<string, string> = {};

  async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
    const headers: Record<string, string> = {
      // A FormData body (chat attachments) must let fetch write the multipart boundary.
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      Accept: "application/json",
      ...identity,
      "X-Client-Platform": "mobile",
      "X-Request-ID": createRequestId(),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeoutMs = init.body instanceof FormData ? UPLOAD_TIMEOUT_MS : FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const caller = init.signal;
    const onCallerAbort = () => controller.abort();
    if (caller?.aborted) controller.abort();
    else caller?.addEventListener("abort", onCallerAbort);
    const impl: FetchLike = init.body instanceof FormData ? (input, request) => fetch(input, request) : credentialFetch;
    try {
      return await impl(`${runtimeConfig().apiUrl}${path}`, {
        ...init,
        method: init.method ?? "GET",
        headers,
        // The bearer goes to the API host only, never where a 3xx points (audit "Security & privacy").
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && !caller?.aborted) {
        throw new ApiError(`Request timed out after ${timeoutMs}ms`, 0);
      }
      // React Native's fetch rejects with TypeError("Network request failed")
      // when the server cannot be reached (DNS, a captive portal, a dead link
      // that NetInfo still calls online). That is the network, not a bug:
      // status 0, like the timeout, so crash reporting leaves it out
      // (data/report.ts) and a send retries it (lib/send-pipeline.ts).
      if (error instanceof TypeError) {
        const offline = new ApiError(error.message || "Network request failed", 0);
        offline.cause = error;
        throw offline;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    }
  }

  /** JSON in, parsed JSON (or undefined on 204) out; non-2xx is an ApiError */
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    let res = await send(path, init, await deps.session.getAccessToken());
    // the native auth routes answer 401 on their own terms; refreshing there would loop
    if (res.status === 401 && !path.startsWith("/api/v1/auth/desktop/")) {
      const renewed = await deps.session.refresh();
      if (renewed) res = await send(path, init, renewed);
      // a transient refresh failure keeps the session (server-unreachable), so the 401 is not a sign-out
      const ended = renewed ? res.status === 401 : deps.session.status() === "signed-out";
      if (ended && !unauthorizedReported) {
        unauthorizedReported = true;
        onUnauthorized?.();
      }
    }
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }
      const retryAfter = Number(res.headers.get("Retry-After"));
      throw new ApiError(
        messageOf(body, res),
        res.status,
        body,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        endpointShape(init.method, path),
      );
    }
    unauthorizedReported = false;
    if (res.status === 204) return undefined;
    return res.json();
  }

  async function fetchValidated<T>(path: string, schema: ZodType, fallback: T, opts: Opts & { endpoint: string }): Promise<T> {
    const raw = await request(path, { signal: opts.signal });
    return parseWithFallback(raw, schema, fallback, { endpoint: opts.endpoint });
  }

  /**
   * For an answer no fallback stands in for: a drifted body rejects with a SchemaMismatchError (endpoint and paths,
   * never the body) that the screen shows as an error with Retry and crash reporting hears of (data/report.ts). A
   * drifted workspace list read as `[]` told a person "you are in no workspace" and nobody else anything.
   */
  async function fetchStrict<T>(path: string, schema: ZodType<T>, opts: Opts & { endpoint: string }): Promise<T> {
    const raw = await request(path, { signal: opts.signal });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new SchemaMismatchError(opts.endpoint, issuePaths(parsed.error.issues));
    return parsed.data;
  }

  return {
    request,
    setOnUnauthorized(cb: () => void) {
      onUnauthorized = cb;
    },
    setClientIdentity(headers: Record<string, string>) {
      identity = { ...headers };
    },
    /** The boot's strict fetch (data/auth/strict-fetch.ts) for every request but a multipart upload. */
    setCredentialFetch(impl: FetchLike) {
      credentialFetch = impl;
    },
    async getMe(opts?: Opts): Promise<User | null> {
      const parsed = await fetchValidated<{ user: User } | null>("/api/v1/me", MeResponseSchema, null, {
        ...opts,
        endpoint: "GET /api/v1/me",
      });
      return parsed?.user ?? null;
    },
    /** Strict (fetchStrict): `[]` here means "you are in no workspace", so a drifted answer must not read as one. */
    async listWorkspaces(opts?: Opts): Promise<Workspace[]> {
      const parsed = await fetchStrict("/api/v1/workspaces", WorkspacesResponseSchema, { ...opts, endpoint: "GET /api/v1/workspaces" });
      return parsed.workspaces;
    },
    async subscribePush(body: PushSubscription): Promise<void> {
      await request("/api/v1/me/push-subscriptions", { method: "POST", body: JSON.stringify(body) });
    },
    async unsubscribePush(body: { endpoint: string }): Promise<void> {
      await request("/api/v1/me/push-subscriptions", { method: "DELETE", body: JSON.stringify(body) });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api: ApiClient = createApiClient({ session });
