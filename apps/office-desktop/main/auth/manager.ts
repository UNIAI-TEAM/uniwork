import { DESKTOP_IDENTITY } from "../../shared/identity";
import { LoginAttemptStore, type PendingLoginAttempt } from "./attempt-store";
import { validateCallback, type CallbackRejectReason, type CallbackValidation } from "./callback";
import type { SystemBrowserLauncher } from "./browser";
import type { CredentialSession, CredentialStore } from "./credentials";
import type { AuthTransport, DesktopSessionResponse } from "../transport/auth-transport";

export type LoginSessionMetadata = Readonly<{
  status: "signed-out" | "pending" | "signed-in";
  accountId?: string;
  deploymentId?: string;
}>;

export type LoginManagerOptions = Readonly<{
  clientId: string;
  deploymentId: string;
  redirectUri?: string;
  attempts?: LoginAttemptStore;
  browser: SystemBrowserLauncher;
  transport: AuthTransport;
  credentials: CredentialStore;
  now?: () => number;
  logger?: (event: Readonly<Record<string, string>>) => void;
  onMetadata?: (metadata: LoginSessionMetadata) => void;
}>;

export type LoginStartResult = Readonly<{ status: "pending"; attemptId: string; expiresAt: number }>;
export type LoginCallbackResult =
  | Readonly<{ ok: true; metadata: LoginSessionMetadata }>
  | Readonly<{ ok: false; reason: CallbackRejectReason | "exchange_failed" | "browser_failed" }>;

export class NativeLoginManager {
  private readonly options: LoginManagerOptions;
  private readonly attempts: LoginAttemptStore;
  private metadata: LoginSessionMetadata = Object.freeze({ status: "signed-out" });

  constructor(options: LoginManagerOptions) {
    this.options = options;
    this.attempts = options.attempts ?? new LoginAttemptStore();
    if ((options.redirectUri ?? DESKTOP_IDENTITY.authCallback) !== DESKTOP_IDENTITY.authCallback) throw new Error("Only the registered desktop callback is allowed");
  }

  getMetadata(): LoginSessionMetadata { return this.metadata; }
  isBound(clientId: string, deploymentId: string): boolean { return clientId === this.options.clientId && deploymentId === this.options.deploymentId; }
  getCurrentAttempt(now = this.clock()): PendingLoginAttempt | undefined { return this.attempts.current(now); }

  async startLogin(): Promise<LoginStartResult> {
    const attempt = this.attempts.begin({ clientId: this.options.clientId, deploymentId: this.options.deploymentId, redirectUri: this.options.redirectUri ?? DESKTOP_IDENTITY.authCallback, now: this.clock() });
    this.setMetadata({ status: "pending" });
    try {
      const response = await this.options.transport.start({ clientId: attempt.clientId, codeChallenge: attempt.codeChallenge, codeChallengeMethod: "S256", state: attempt.state, redirectUri: attempt.redirectUri, deploymentId: attempt.deploymentId });
      const authorizationUrl = new URL(response.authorizationUrl);
      if (authorizationUrl.protocol !== "https:") throw new Error("Authorization URL must use HTTPS");
      await this.options.browser.open(response.authorizationUrl);
    } catch {
      this.attempts.cancel(attempt.attemptId);
      this.setMetadata({ status: "signed-out" });
      this.options.logger?.({ event: "auth_browser_start_failed", attemptId: attempt.attemptId });
      throw new Error("Unable to open the system browser");
    }
    return { status: "pending", attemptId: attempt.attemptId, expiresAt: attempt.expiresAt };
  }

  cancelLogin(attemptId?: string): LoginSessionMetadata {
    const cancelled = this.attempts.cancel(attemptId);
    if (cancelled || (this.metadata.status === "pending" && !this.attempts.current(this.clock()))) this.setMetadata({ status: "signed-out" });
    return this.metadata;
  }

  async handleCallback(callbackUrl: string): Promise<LoginCallbackResult> {
    const attempt = this.attempts.current(this.clock());
    const validation = validateCallback(callbackUrl, attempt, { now: this.clock(), expectedClientId: this.options.clientId, expectedDeploymentId: this.options.deploymentId, logger: (event) => this.options.logger?.({ event: event.event, ...(event.attemptId ? { attemptId: event.attemptId } : {}), reason: event.reason }) });
    if (!validation.ok) {
      if (this.metadata.status === "pending" && (validation.reason === "expired" || validation.reason === "no_attempt" || validation.reason === "verifier_missing")) this.setMetadata({ status: "signed-out" });
      return validation;
    }
    const claimed = this.attempts.consume(validation.attemptId, this.clock());
    if (!claimed) {
      this.options.logger?.({ event: "auth_callback_rejected", attemptId: validation.attemptId, reason: "no_attempt" });
      return { ok: false, reason: "no_attempt" };
    }
    try {
      const session = await this.options.transport.exchange({ clientId: claimed.clientId, code: validation.code, codeVerifier: claimed.verifier, redirectUri: claimed.redirectUri, deploymentId: claimed.deploymentId });
      if (session.deploymentId !== this.options.deploymentId) throw new Error("Auth exchange deployment mismatch");
      await this.options.credentials.save(toCredentialSession(session));
      this.setMetadata({ status: "signed-in", accountId: session.accountId, deploymentId: session.deploymentId });
      return { ok: true, metadata: this.metadata };
    } catch {
      this.setMetadata({ status: "signed-out" });
      this.options.logger?.({ event: "auth_exchange_failed", attemptId: claimed.attemptId });
      return { ok: false, reason: "exchange_failed" };
    }
  }

  private clock(): number { return this.options.now?.() ?? Date.now(); }
  private setMetadata(metadata: LoginSessionMetadata): void {
    this.metadata = Object.freeze({ ...metadata });
    this.options.onMetadata?.(this.metadata);
  }
}

function toCredentialSession(session: DesktopSessionResponse): CredentialSession {
  return { accountId: session.accountId, deviceSessionId: session.deviceSessionId, sessionId: session.sessionId, accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn: session.expiresIn, refreshExpiresIn: session.refreshExpiresIn };
}
