import type { ShellConfig } from "../runtime-config";

/**
 * Main-process HTTP client for the four UniWork desktop auth routes. The only
 * URLs it can build are `apiUrl` + one of the routes below; responses are
 * parsed strictly from the server's snake_case DTOs and fail closed on a
 * missing or mistyped field.
 */

export type TransportErrorCode =
  | "network"
  | "timeout"
  | "server_error"
  | "malformed_response"
  | "rate_limited"
  | "unauthorized"
  | "auth_code_invalid"
  | "device_revoked"
  | "refresh_reused"
  | "wrong_deployment"
  | "desktop_auth_unavailable"
  | "invalid_request"
  | "forbidden";

export class TransportError extends Error {
  readonly code: TransportErrorCode;
  readonly status?: number;
  /**
   * true when the code is the server's own `{error:{code}}` verdict; false
   * when it was only inferred from the HTTP status (a gateway or captive
   * portal can answer 401 without the UniWork server ever seeing the call)
   */
  readonly fromServer: boolean;
  /** `Retry-After` of a 429, in ms, when the server sent one in seconds */
  readonly retryAfterMs?: number;
  constructor(code: TransportErrorCode, status?: number, fromServer = false, retryAfterMs?: number) {
    // never carries a URL, body, or token: the code is the whole story
    super(`uniwork request failed: ${code}`);
    this.name = "TransportError";
    this.code = code;
    this.status = status;
    this.fromServer = fromServer;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface DesktopSession {
  accountId: string;
  deviceSessionId: string;
  sessionId: string;
  deploymentId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

interface StartRequest {
  clientId: string;
  codeChallenge: string;
  state: string;
  redirectUri: string;
  deviceLabel?: string;
  platform?: string;
}

export interface Transport {
  start(request: StartRequest): Promise<{ authorizationUrl: string }>;
  exchange(request: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<DesktopSession>;
  refresh(request: { deviceSessionId: string; refreshToken: string }): Promise<DesktopSession>;
  logout(request: { deviceSessionId: string }, accessToken: string): Promise<void>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 15_000;

type Route = "/auth/desktop/start" | "/auth/desktop/exchange" | "/auth/desktop/refresh" | "/auth/desktop/logout";

/** server error code -> transport code; anything else falls back by status */
const SERVER_CODES: ReadonlySet<string> = new Set([
  "unauthorized",
  "auth_code_invalid",
  "device_revoked",
  "refresh_reused",
  "rate_limited",
  "desktop_auth_unavailable",
  "invalid_request",
  "forbidden",
]);

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** HTTPS, or plain HTTP to a loopback host in dev only. */
export function isAllowedOrigin(url: URL, env: ShellConfig["env"]): boolean {
  if (url.protocol === "https:") return true;
  return env === "dev" && url.protocol === "http:" && isLoopbackHost(url.hostname);
}

async function errorFromResponse(response: Response): Promise<TransportError> {
  let code: unknown;
  try {
    const body = (await response.json()) as { error?: { code?: unknown } } | null;
    code = body?.error?.code;
  } catch {
    // no JSON body
  }
  const status = response.status;
  const retryAfter = response.headers.get("Retry-After");
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  if (typeof code === "string" && SERVER_CODES.has(code)) {
    return new TransportError(code as TransportErrorCode, status, true, retryAfterMs);
  }
  if (status === 429) return new TransportError("rate_limited", status, false, retryAfterMs);
  if (status >= 500) return new TransportError("server_error", status);
  if (status === 401) return new TransportError("unauthorized", status);
  if (status === 403) return new TransportError("forbidden", status);
  return new TransportError("invalid_request", status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new TransportError("malformed_response");
  return value;
}

function positiveInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TransportError("malformed_response");
  }
  return value;
}

function parseSession(raw: unknown, deploymentId: string): DesktopSession {
  if (!isRecord(raw)) throw new TransportError("malformed_response");
  const session: DesktopSession = {
    accountId: str(raw.account_id),
    deviceSessionId: str(raw.device_session_id),
    sessionId: str(raw.session_id),
    deploymentId: str(raw.deployment_id),
    accessToken: str(raw.access_token),
    refreshToken: str(raw.refresh_token),
    expiresIn: positiveInt(raw.expires_in),
    refreshExpiresIn: positiveInt(raw.refresh_expires_in),
  };
  if (raw.token_type !== undefined && raw.token_type !== "Bearer") throw new TransportError("malformed_response");
  if (session.deploymentId !== deploymentId) throw new TransportError("wrong_deployment");
  return session;
}

export function createTransport(
  config: ShellConfig,
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): Transport {
  const origin = new URL(config.apiUrl);
  if (!isAllowedOrigin(origin, config.env)) throw new Error("UNICHAT_API_URL must use HTTPS");
  const base = `${origin.origin}/api/v1`;
  const fetchImpl: FetchLike = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const { deploymentId } = config;

  async function request(
    method: "GET" | "POST",
    route: Route,
    opts: { query?: URLSearchParams; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    let timedOut = false;
    // the deadline covers the whole exchange, body included: a server or proxy
    // that sends headers and then stalls must not hang a shared refresh forever
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${base}${route}${opts.query ? `?${opts.query}` : ""}`, {
          method,
          headers,
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        });
      } catch {
        throw new TransportError(timedOut ? "timeout" : "network");
      }
      if (!response.ok) {
        const error = await errorFromResponse(response);
        throw timedOut ? new TransportError("timeout") : error;
      }
      try {
        return await response.json();
      } catch {
        throw new TransportError(timedOut ? "timeout" : "malformed_response", response.status);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async start(input) {
      const query = new URLSearchParams({
        client_id: input.clientId,
        code_challenge: input.codeChallenge,
        code_challenge_method: "S256",
        state: input.state,
        redirect_uri: input.redirectUri,
        deployment_id: deploymentId,
      });
      if (input.deviceLabel) query.set("device_label", input.deviceLabel);
      if (input.platform) query.set("platform", input.platform);
      const raw = await request("GET", "/auth/desktop/start", { query });
      if (!isRecord(raw)) throw new TransportError("malformed_response");
      let parsed: URL;
      try {
        parsed = new URL(str(raw.authorization_url));
      } catch (error) {
        throw error instanceof TransportError ? error : new TransportError("malformed_response");
      }
      if (!isAllowedOrigin(parsed, config.env) || parsed.username || parsed.password) {
        throw new TransportError("malformed_response");
      }
      return { authorizationUrl: parsed.href };
    },
    async exchange(input) {
      const raw = await request("POST", "/auth/desktop/exchange", {
        body: {
          client_id: input.clientId,
          code: input.code,
          code_verifier: input.codeVerifier,
          redirect_uri: input.redirectUri,
          deployment_id: deploymentId,
        },
      });
      return parseSession(raw, deploymentId);
    },
    async refresh(input) {
      const raw = await request("POST", "/auth/desktop/refresh", {
        // the server budgets refreshes per device under this header (router/auth.go)
        headers: { "X-UniWork-Device": input.deviceSessionId },
        body: {
          device_session_id: input.deviceSessionId,
          refresh_token: input.refreshToken,
          deployment_id: deploymentId,
        },
      });
      return parseSession(raw, deploymentId);
    },
    async logout(input, accessToken) {
      await request("POST", "/auth/desktop/logout", {
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { device_session_id: input.deviceSessionId, deployment_id: deploymentId, scope: "device" },
      });
    },
  };
}
