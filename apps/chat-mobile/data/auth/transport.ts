// Ported from apps/chat-desktop/src/main/auth/transport.ts. The API origin is
// read from runtimeConfig() per call (configureRuntime() runs at boot) and the
// dev loopback rule is gone: a phone reaches the dev server over LAN http.
import type { EndpointRequest } from "@uniwork/core/api/endpoints/endpoint-request";
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { runtimeConfig } from "@uniwork/core/runtime-config";

/**
 * HTTP client for the four UniWork native auth routes and, through createAuthRequest / createEndpointRequest, the
 * doors of the app's own sign-in screen (ADR 0047 §8: /auth/native/*, read by core's sign-in-native-api.ts) and
 * /auth/providers. The only URLs it can build are `apiUrl` + one of the routes below; responses are parsed strictly
 * from the server's snake_case DTOs and fail closed on a missing or mistyped field.
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
  | "forbidden"
  // The app's sign-in doors (ADR 0047 §8, spec §3.6): what each one refuses with
  | "invalid_credentials"
  | "second_factor_locked"
  | "provider_token_invalid"
  | "native_sign_in_unavailable"
  | "google_not_configured"
  | "apple_auth_unavailable"
  | "conflict"
  | "invalid_code"
  | "sign_in_ticket_missing"
  | "sign_in_ticket_channel"
  | "sign_in_account_conflict"
  | "sign_in_email_unverified"
  | "sign_in_account_unverified"
  | "sign_in_method_taken"
  | "sign_in_method_already_linked"
  | "cross_site_request"
  | "unsupported_media_type"
  /** never the server's: the second step or the ticket the app held for one is gone (expired, or the app restarted) */
  | "sign_in_expired";

/**
 * The parts of a refusal's `error.fields` a sign-in screen reads (core's auth/sign-in-errors.ts), each checked for its
 * type; nothing else of the body is kept. None is a secret: the server masks the address itself.
 */
export interface TransportErrorFields {
  /** sign_in_method_taken / _movable: who holds the identity, masked (a•••@icloud.com) */
  readonly masked_email?: string;
  /** proof_required: the proofs the server takes */
  readonly proofs?: readonly string[];
  /** second_factor_locked, a code asked again too soon: whole seconds to wait */
  readonly retry_after?: number;
}

export class TransportError extends Error {
  readonly code: TransportErrorCode;
  readonly status?: number;
  /**
   * true when the code is the server's own `{error:{code}}` verdict; false
   * when it was only inferred from the HTTP status (a gateway or captive
   * portal can answer 401 without the UniWork server ever seeing the call)
   */
  readonly fromServer: boolean;
  /** `Retry-After` of a 429 (or the body's `retry_after`), in ms, when the server sent one in seconds */
  readonly retryAfterMs?: number;
  readonly fields: TransportErrorFields;
  constructor(code: TransportErrorCode, status?: number, fromServer = false, retryAfterMs?: number, fields: TransportErrorFields = {}) {
    // never carries a URL, a body or a token: the code and the few fields above are the whole story
    super(`uniwork request failed: ${code}`);
    this.name = "TransportError";
    this.code = code;
    this.status = status;
    this.fromServer = fromServer;
    this.retryAfterMs = retryAfterMs;
    this.fields = fields;
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
  /** the provider button the person tapped (spec §3.5): the web sign-in page goes straight to it */
  provider?: SignInProvider;
}

export interface Transport {
  start(request: StartRequest): Promise<{ authorizationUrl: string }>;
  exchange(request: { clientId: string; code: string; codeVerifier: string; redirectUri: string }): Promise<DesktopSession>;
  refresh(request: { deviceSessionId: string; refreshToken: string }): Promise<DesktopSession>;
  logout(request: { deviceSessionId: string }, accessToken: string): Promise<void>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 15_000;

type Route =
  | "/auth/desktop/start"
  | "/auth/desktop/exchange"
  | "/auth/desktop/refresh"
  | "/auth/desktop/logout"
  | "/auth/providers"
  | "/auth/native/password"
  | "/auth/native/mfa"
  | "/auth/native/google"
  | "/auth/native/apple"
  | "/auth/native/register"
  | "/auth/native/sign-in-ticket/create"
  | "/auth/native/sign-in-ticket/claim-email"
  | "/auth/native/sign-in-ticket/claim-email/verify";

/** Route, at run time: createEndpointRequest takes a path from core and sends only one of these. */
const ROUTES: ReadonlySet<string> = new Set<Route>([
  "/auth/desktop/start",
  "/auth/desktop/exchange",
  "/auth/desktop/refresh",
  "/auth/desktop/logout",
  "/auth/providers",
  "/auth/native/password",
  "/auth/native/mfa",
  "/auth/native/google",
  "/auth/native/apple",
  "/auth/native/register",
  "/auth/native/sign-in-ticket/create",
  "/auth/native/sign-in-ticket/claim-email",
  "/auth/native/sign-in-ticket/claim-email/verify",
]);

const isRoute = (path: string): path is Route => ROUTES.has(path);

/** server error code -> transport code; anything else falls back by status */
const SERVER_CODES: ReadonlySet<string> = new Set<TransportErrorCode>([
  "unauthorized",
  "auth_code_invalid",
  "device_revoked",
  "refresh_reused",
  "rate_limited",
  "desktop_auth_unavailable",
  "invalid_request",
  "forbidden",
  "invalid_credentials",
  "second_factor_locked",
  "provider_token_invalid",
  "native_sign_in_unavailable",
  "google_not_configured",
  "apple_auth_unavailable",
  "conflict",
  "invalid_code",
  "sign_in_ticket_missing",
  "sign_in_ticket_channel",
  "sign_in_account_conflict",
  "sign_in_email_unverified",
  "sign_in_account_unverified",
  "sign_in_method_taken",
  "sign_in_method_already_linked",
  "cross_site_request",
  "unsupported_media_type",
]);

const isServerCode = (code: unknown): code is TransportErrorCode => typeof code === "string" && SERVER_CODES.has(code);

const positiveSeconds = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/** The envelope's `error.fields`, kept only where TransportErrorFields names the key and the type matches. */
function fieldsOf(raw: unknown): TransportErrorFields {
  if (!isRecord(raw)) return {};
  const proofs = Array.isArray(raw.proofs) ? raw.proofs.filter((p): p is string => typeof p === "string") : undefined;
  const retryAfter = positiveSeconds(raw.retry_after);
  return {
    ...(typeof raw.masked_email === "string" && raw.masked_email ? { masked_email: raw.masked_email } : {}),
    ...(proofs ? { proofs } : {}),
    ...(retryAfter ? { retry_after: retryAfter } : {}),
  };
}

async function errorFromResponse(response: Response): Promise<TransportError> {
  let error: Record<string, unknown> = {};
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) error = body.error;
  } catch {
    // no JSON body
  }
  const status = response.status;
  const fields = fieldsOf(error.fields);
  const retryAfter = response.headers.get("Retry-After");
  const headerSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
  const seconds = headerSeconds ?? fields.retry_after;
  const retryAfterMs = seconds === undefined ? undefined : seconds * 1000;
  if (isServerCode(error.code)) return new TransportError(error.code, status, true, retryAfterMs, fields);
  if (status === 429) return new TransportError("rate_limited", status, false, retryAfterMs);
  if (status >= 500) return new TransportError("server_error", status);
  if (status === 401) return new TransportError("unauthorized", status);
  if (status === 403) return new TransportError("forbidden", status);
  return new TransportError("invalid_request", status);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
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

export function parseSession(raw: unknown, deploymentId: string): DesktopSession {
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

function appOrigin(): string | null {
  try {
    return new URL(runtimeConfig().appUrl).origin;
  } catch {
    return null;
  }
}

/** One request to an auth route: the timeout, the strict parsing of errors, no redirect, no cache. */
export function createAuthRequest(options: { fetch: FetchLike; timeoutMs?: number }) {
  const fetchImpl = options.fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return async function request(
    method: "GET" | "POST",
    route: Route,
    opts: { query?: URLSearchParams; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    // Hermes has no AbortSignal.timeout(): one controller, aborted by a timer
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
        response = await fetchImpl(`${runtimeConfig().apiUrl}/api/v1${route}${opts.query ? `?${opts.query}` : ""}`, {
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
  };
}

/** `/api/v1` + a route, no query: a regular expression, so the route catalogue reads the routes from Route alone */
const API_PATH = /^\/api\/v1(\/[^?#]*)$/;

/**
 * The auth routes as core's EndpointRequest, for the factories of the app's sign-in doors (core's
 * sign-in-native-api.ts): the same timeout, strict errors, no redirect and no cache as createAuthRequest. A path that
 * is not `/api/v1` + one of the routes above, or a method other than GET and POST, is refused before anything is sent.
 */
export function createEndpointRequest(options: { fetch: FetchLike; timeoutMs?: number }): EndpointRequest {
  const request = createAuthRequest(options);
  return async (path, opts = {}) => {
    const route = API_PATH.exec(path)?.[1] ?? "";
    const method = opts.method ?? "GET";
    if (!isRoute(route) || (method !== "GET" && method !== "POST")) throw new TransportError("invalid_request");
    return request(method, route, opts.body === undefined ? {} : { body: opts.body });
  };
}

/** `fetch` is the composition root's choice (data/auth/flow.ts › strictFetch): only a fetch that honours
 *  redirect: "error" natively keeps the code and the refresh token on the API host. */
export function createTransport(config: { deploymentId: string }, options: { fetch: FetchLike; timeoutMs?: number }): Transport {
  const { deploymentId } = config;
  const request = createAuthRequest(options);

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
      if (input.provider) query.set("provider", input.provider);
      const raw = await request("GET", "/auth/desktop/start", { query });
      if (!isRecord(raw)) throw new TransportError("malformed_response");
      let parsed: URL;
      try {
        parsed = new URL(str(raw.authorization_url));
      } catch (error) {
        throw error instanceof TransportError ? error : new TransportError("malformed_response");
      }
      // The sign-in page is the app's own (the server builds it from FRONTEND_ORIGIN): same scheme, host and port as
      // appUrl, which a release build only accepts as https (app.config.ts › serverUrl). Anything else is not opened.
      if (parsed.origin !== appOrigin() || parsed.username || parsed.password) {
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
