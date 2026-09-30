import { createCodeChallenge } from "../auth/pkce";
import { AuthTransportError, type AuthServerContract, type DesktopExchangeRequest, type DesktopRefreshRequest, type DesktopSessionResponse, type DesktopStartRequest, type DesktopStartResponse, type DesktopLogoutRequest } from "./auth-transport";

type AuthorizationCode = Readonly<DesktopStartRequest & { code: string; accountId: string; issuedAt: number; expiresAt: number; used: boolean }>;
export const FAKE_AUTH_CODE_TTL_MS = 120 * 1000;

export type FakeAuthServerOptions = Readonly<{ origin?: string; now?: () => number; accountId?: string }>;

/** Contract-first fake for unit tests. It models single-use PKCE code
 * redemption and returns deterministic metadata; it is never a production
 * endpoint and intentionally keeps raw values in memory only. */
export class FakeAuthServer implements AuthServerContract {
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly origin: string;
  private readonly now: () => number;
  private readonly accountId: string;
  private sequence = 0;
  private readonly sessions = new Map<string, DesktopSessionResponse>();
  private readonly revoked = new Set<string>();

  constructor(options: FakeAuthServerOptions = {}) {
    this.origin = options.origin ?? "https://fake-auth.invalid";
    this.now = options.now ?? (() => Date.now());
    this.accountId = options.accountId ?? "account-test";
  }

  async start(request: DesktopStartRequest): Promise<DesktopStartResponse> {
    validateStart(request);
    const issuedAt = this.now();
    const code = `fake-code-${++this.sequence}`;
    this.codes.set(code, Object.freeze({ ...request, code, accountId: this.accountId, issuedAt, expiresAt: issuedAt + FAKE_AUTH_CODE_TTL_MS, used: false }));
    const query = new URLSearchParams({ client_id: request.clientId, code_challenge: request.codeChallenge, code_challenge_method: request.codeChallengeMethod, state: request.state, redirect_uri: request.redirectUri, deployment_id: request.deploymentId });
    return { authorizationUrl: `${this.origin}/auth/desktop/authorize?${query.toString()}`, attemptExpiresAt: new Date(issuedAt + 10 * 60 * 1000).toISOString() };
  }

  /** Test helper that simulates the browser's approved redirect. */
  issueCallback(request: Pick<DesktopStartRequest, "state" | "redirectUri" | "clientId" | "deploymentId">): string {
    const code = [...this.codes.values()].reverse().find((candidate) => candidate.state === request.state && candidate.clientId === request.clientId && candidate.deploymentId === request.deploymentId && candidate.redirectUri === request.redirectUri)?.code;
    if (!code) throw new Error("No fake authorization attempt");
    return `${request.redirectUri}?${new URLSearchParams({ code, state: request.state }).toString()}`;
  }

  async exchange(request: DesktopExchangeRequest): Promise<DesktopSessionResponse> {
    const candidate = this.codes.get(request.code);
    if (!candidate || candidate.used || candidate.expiresAt <= this.now()) throw new Error("auth_code_invalid");
    if (candidate.clientId !== request.clientId || candidate.deploymentId !== request.deploymentId || candidate.redirectUri !== request.redirectUri || createCodeChallenge(request.codeVerifier) !== candidate.codeChallenge) throw new Error("auth_code_invalid");
    this.codes.set(request.code, Object.freeze({ ...candidate, used: true }));
    const session = { accountId: candidate.accountId, deviceSessionId: `device-${candidate.code}`, sessionId: `session-${candidate.code}`, deploymentId: candidate.deploymentId, accessToken: `fake-access-${candidate.code}`, refreshToken: `fake-refresh-${candidate.code}`, expiresIn: 900, refreshExpiresIn: 2_592_000, refreshRotates: true };
    this.sessions.set(session.deviceSessionId, session);
    return session;
  }

  async refresh(request: DesktopRefreshRequest): Promise<DesktopSessionResponse> {
    const current = this.sessions.get(request.deviceSessionId);
    if (!current || this.revoked.has(request.deviceSessionId)) throw new AuthTransportError("device_revoked", 401);
    if (current.refreshToken !== request.refreshToken) { this.revoked.add(request.deviceSessionId); throw new AuthTransportError("refresh_reused", 401); }
    const next = { ...current, accessToken: `fake-access-${++this.sequence}`, refreshToken: `fake-refresh-${this.sequence}` };
    this.sessions.set(request.deviceSessionId, next);
    return next;
  }

  async logout(request: DesktopLogoutRequest): Promise<void> {
    this.revoked.add(request.deviceSessionId);
    this.sessions.delete(request.deviceSessionId);
  }
}

function validateStart(request: DesktopStartRequest): void {
  if (!request.clientId || !request.deploymentId || request.codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(request.codeChallenge) || !request.state || !request.redirectUri) throw new Error("invalid_request");
}
