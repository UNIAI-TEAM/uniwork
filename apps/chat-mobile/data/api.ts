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
import { session } from "./auth/flow";
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
  constructor(message: string, status: number, body?: unknown, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
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

/** the Expo push token goes in `endpoint`; `platform` is required for it (server SDI) */
export type PushSubscription = PushSubscriptionBody & { platform: string };

const createRequestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function messageOf(body: unknown, res: Response): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message : `${res.status} ${res.statusText}`;
}

export function createApiClient(deps: ApiClientDeps) {
  let onUnauthorized = deps.onUnauthorized;
  let unauthorizedReported = false;

  async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
    const headers: Record<string, string> = {
      // A FormData body (chat attachments) must let fetch write the multipart boundary.
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      Accept: "application/json",
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
    try {
      return await fetch(`${runtimeConfig().apiUrl}${path}`, {
        ...init,
        method: init.method ?? "GET",
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted && !caller?.aborted) {
        throw new ApiError(`Request timed out after ${timeoutMs}ms`, 0);
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
      throw new ApiError(messageOf(body, res), res.status, body, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
    }
    unauthorizedReported = false;
    if (res.status === 204) return undefined;
    return res.json();
  }

  async function fetchValidated<T>(path: string, schema: ZodType, fallback: T, opts: Opts & { endpoint: string }): Promise<T> {
    const raw = await request(path, { signal: opts.signal });
    return parseWithFallback(raw, schema, fallback, { endpoint: opts.endpoint });
  }

  return {
    request,
    setOnUnauthorized(cb: () => void) {
      onUnauthorized = cb;
    },
    async getMe(opts?: Opts): Promise<User | null> {
      const parsed = await fetchValidated<{ user: User } | null>("/api/v1/me", MeResponseSchema, null, {
        ...opts,
        endpoint: "GET /api/v1/me",
      });
      return parsed?.user ?? null;
    },
    async listWorkspaces(opts?: Opts): Promise<Workspace[]> {
      const parsed = await fetchValidated<{ workspaces: Workspace[] }>(
        "/api/v1/workspaces",
        WorkspacesResponseSchema,
        { workspaces: [] },
        { ...opts, endpoint: "GET /api/v1/workspaces" },
      );
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
