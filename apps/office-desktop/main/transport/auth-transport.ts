import type { DeploymentProfile } from "../../shared/deployment";

export type DesktopStartRequest = Readonly<{
  clientId: string; codeChallenge: string; codeChallengeMethod: "S256"; state: string; redirectUri: string; deploymentId: string;
  deviceLabel?: string; platform?: string; build?: string;
}>;
export type DesktopStartResponse = Readonly<{ authorizationUrl: string; attemptExpiresAt: string }>;
export type DesktopExchangeRequest = Readonly<{ clientId: string; code: string; codeVerifier: string; redirectUri: string; deploymentId: string; deviceLabel?: string; platform?: string; build?: string }>;
export type DesktopSessionResponse = Readonly<{ accountId: string; deviceSessionId: string; sessionId: string; deploymentId: string; accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number; refreshRotates?: boolean }>;
export type DesktopRefreshRequest = Readonly<{ deviceSessionId: string; refreshToken: string; deploymentId: string }>;
export type DesktopLogoutRequest = Readonly<{ deviceSessionId: string; deploymentId: string; scope?: "device" | "family" }>;
export type DesktopDevice = Readonly<{ id: string; clientId: string; deploymentId: string; deviceLabel: string; platform: string; build: string; createdAt: string; lastUsedAt: string; expiresAt: string; revokedAt: string | null; current: boolean }>;

export type AuthTransportErrorCode = "unauthorized" | "device_revoked" | "refresh_reused" | "rate_limited" | "invalid_request" | "network" | "malformed_response";
export class AuthTransportError extends Error {
  readonly code: AuthTransportErrorCode; readonly status?: number;
  constructor(code: AuthTransportErrorCode, status?: number) { super("desktop authentication request failed"); this.name = "AuthTransportError"; this.code = code; this.status = status; }
}
export type AuthTransport = Readonly<{
  start(request: DesktopStartRequest): Promise<DesktopStartResponse>;
  exchange(request: DesktopExchangeRequest): Promise<DesktopSessionResponse>;
  refresh?(request: DesktopRefreshRequest): Promise<DesktopSessionResponse>;
  logout?(request: DesktopLogoutRequest, accessToken: string): Promise<void>;
  devices?(accessToken: string): Promise<readonly DesktopDevice[]>;
  revokeDevice?(deviceSessionId: string, accessToken: string): Promise<void>;
}>;
export type AuthServerContract = Readonly<{
  start(request: DesktopStartRequest): Promise<DesktopStartResponse>;
  exchange(request: DesktopExchangeRequest): Promise<DesktopSessionResponse>;
  refresh?(request: DesktopRefreshRequest): Promise<DesktopSessionResponse>;
  logout?(request: DesktopLogoutRequest, accessToken: string): Promise<void>;
}>;
export type HostTransportOptions = Readonly<{ origin: string; clientId: string; deploymentId: string; server: AuthServerContract }>;

/** Contract fake seam. Its dispatch surface mirrors the real HTTP client and
 * refuses all paths/methods that are not explicitly registered. */
export function createAllowlistedAuthTransport(options: HostTransportOptions): AuthTransport {
  assertOrigin(options.origin, true);
  if (!options.clientId || !options.deploymentId) throw new Error("Auth transport binding is incomplete");
  const assertBinding = (clientId: string | undefined, deploymentId: string) => {
    if ((clientId !== undefined && clientId !== options.clientId) || deploymentId !== options.deploymentId) throw new AuthTransportError("invalid_request");
  };
  return Object.freeze({
    start: async (request: DesktopStartRequest) => { assertBinding(request.clientId, request.deploymentId); return options.server.start(request); },
    exchange: async (request: DesktopExchangeRequest) => { assertBinding(request.clientId, request.deploymentId); return options.server.exchange(request); },
    refresh: options.server.refresh ? async (request: DesktopRefreshRequest) => { assertBinding(undefined, request.deploymentId); return options.server.refresh!(request); } : undefined,
    logout: options.server.logout ? async (request: DesktopLogoutRequest, accessToken: string) => { assertBinding(undefined, request.deploymentId); return options.server.logout!(request, accessToken); } : undefined,
  });
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Real main-process client. The only URL it can construct is profile origin
 * plus one of the registered desktop auth routes. */
export function createHttpAuthTransport(profile: DeploymentProfile, fetchImpl: FetchLike = fetch): AuthTransport {
  assertOrigin(profile.apiOrigin, profile.channel === "dev");
  const origin = profile.apiOrigin.replace(/\/$/, "");
  const binding = (deploymentId: string, clientId?: string) => { if (deploymentId !== profile.deploymentId || (clientId !== undefined && clientId !== profile.clientId)) throw new AuthTransportError("invalid_request"); };
  const request = async <T>(method: "GET" | "POST" | "DELETE", path: "/auth/desktop/start" | "/auth/desktop/exchange" | "/auth/desktop/refresh" | "/auth/desktop/logout" | "/auth/desktop/devices" | `/auth/desktop/devices/${string}`, query?: URLSearchParams, body?: unknown, accessToken?: string): Promise<T> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    const init: RequestInit = { method, headers, cache: "no-store", redirect: "error" };
    if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let response: Response;
    try { response = await fetchImpl(`${origin}/api/v1${path}${query ? `?${query}` : ""}`, init); }
    catch { throw new AuthTransportError("network"); }
    if (!response.ok) throw await wireError(response.status, response);
    try { return await response.json() as T; } catch { throw new AuthTransportError("malformed_response", response.status); }
  };
  return Object.freeze({
    async start(input: DesktopStartRequest) {
      binding(input.deploymentId, input.clientId);
      const query = new URLSearchParams({ client_id: input.clientId, code_challenge: input.codeChallenge, code_challenge_method: input.codeChallengeMethod, state: input.state, redirect_uri: input.redirectUri, deployment_id: input.deploymentId });
      if (input.deviceLabel) query.set("device_label", input.deviceLabel); if (input.platform) query.set("platform", input.platform); if (input.build) query.set("build", input.build);
      const raw = await request<{ authorization_url?: unknown; attempt_expires_at?: unknown }>("GET", "/auth/desktop/start", query);
      if (typeof raw.authorization_url !== "string" || typeof raw.attempt_expires_at !== "string") throw new AuthTransportError("malformed_response");
      const authorizationUrl = new URL(raw.authorization_url); const loopback = authorizationUrl.hostname === "localhost" || authorizationUrl.hostname === "127.0.0.1" || authorizationUrl.hostname === "[::1]";
      if (authorizationUrl.protocol !== "https:" && !(profile.channel === "dev" && authorizationUrl.protocol === "http:" && loopback)) throw new AuthTransportError("malformed_response");
      return { authorizationUrl: raw.authorization_url, attemptExpiresAt: raw.attempt_expires_at };
    },
    async exchange(input: DesktopExchangeRequest) {
      binding(input.deploymentId, input.clientId);
      return parseSession(await request<Record<string, unknown>>("POST", "/auth/desktop/exchange", undefined, { client_id: input.clientId, code: input.code, code_verifier: input.codeVerifier, redirect_uri: input.redirectUri, deployment_id: input.deploymentId, ...(input.deviceLabel ? { device_label: input.deviceLabel } : {}), ...(input.platform ? { platform: input.platform } : {}), ...(input.build ? { build: input.build } : {}) }), profile.deploymentId);
    },
    async refresh(input: DesktopRefreshRequest) {
      binding(input.deploymentId);
      return parseSession(await request<Record<string, unknown>>("POST", "/auth/desktop/refresh", undefined, { device_session_id: input.deviceSessionId, refresh_token: input.refreshToken, deployment_id: input.deploymentId }), profile.deploymentId);
    },
    async logout(input: DesktopLogoutRequest, accessToken: string) {
      binding(input.deploymentId);
      await request("POST", "/auth/desktop/logout", undefined, { device_session_id: input.deviceSessionId, deployment_id: input.deploymentId, ...(input.scope ? { scope: input.scope } : {}) }, accessToken);
    },
    async devices(accessToken: string) {
      const raw = await request<{ devices?: unknown }>("GET", "/auth/desktop/devices", undefined, undefined, accessToken);
      if (!Array.isArray(raw.devices)) throw new AuthTransportError("malformed_response");
      return raw.devices as readonly DesktopDevice[];
    },
    async revokeDevice(deviceSessionId: string, accessToken: string) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceSessionId)) throw new AuthTransportError("invalid_request");
      await request("DELETE", `/auth/desktop/devices/${deviceSessionId}`, undefined, undefined, accessToken);
    },
  });
}

function parseSession(raw: Record<string, unknown>, deploymentId: string): DesktopSessionResponse {
  const strings = ["account_id", "device_session_id", "session_id", "deployment_id", "access_token", "refresh_token"];
  if (!strings.every((key) => typeof raw[key] === "string") || raw.deployment_id !== deploymentId || typeof raw.expires_in !== "number" || typeof raw.refresh_expires_in !== "number" || raw.expires_in <= 0 || raw.refresh_expires_in <= 0) throw new AuthTransportError("malformed_response");
  return { accountId: raw.account_id as string, deviceSessionId: raw.device_session_id as string, sessionId: raw.session_id as string, deploymentId: raw.deployment_id as string, accessToken: raw.access_token as string, refreshToken: raw.refresh_token as string, expiresIn: raw.expires_in as number, refreshExpiresIn: raw.refresh_expires_in as number, refreshRotates: raw.refresh_rotates === true };
}
async function wireError(status: number, response: Response): Promise<AuthTransportError> {
  let code: unknown; try { const body = await response.json() as { error?: { code?: unknown } }; code = body.error?.code; } catch { /* no body */ }
  if (code === "device_revoked" || code === "refresh_reused" || code === "unauthorized" || code === "rate_limited" || code === "invalid_request") return new AuthTransportError(code, status);
  return new AuthTransportError(status === 429 ? "rate_limited" : "unauthorized", status);
}
function assertOrigin(origin: string, allowDevHttp = false): void {
  const parsed = new URL(origin); const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(allowDevHttp && parsed.protocol === "http:" && loopback)) throw new Error("Auth transport origin must use HTTPS");
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/")) throw new Error("Auth transport origin cannot contain credentials or path");
}
