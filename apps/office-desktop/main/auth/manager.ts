import { DESKTOP_IDENTITY, DESKTOP_IDENTITY_MANIFEST } from "../../shared/identity";
import { LoginAttemptStore, type PendingLoginAttempt } from "./attempt-store";
import { validateCallback, type CallbackRejectReason, type CallbackValidation } from "./callback";
import type { SystemBrowserLauncher } from "./browser";
import { CredentialStoreError, type CredentialSession, type CredentialStore } from "./credentials";
import { AuthTransportError, type AuthTransport, type DesktopSessionResponse } from "../transport/auth-transport";

export type LoginSessionMetadata = Readonly<{
  status: "signed-out" | "pending" | "signed-in" | "locked" | "login-required";
  /** Set when the locked state has a named cause the UI can explain (missing
   * Linux Secret Service keyring). */
  lockedReason?: "keyring";
  accountId?: string;
  deploymentId?: string;
}>;

/** One place that maps a credential-store failure to session metadata: a
 * missing keyring keeps the typed reason so the login card shows its fix. */
function credentialFailureMetadata(error: unknown): LoginSessionMetadata {
  if (error instanceof CredentialStoreError && error.code === "keyring_required") return { status: "locked", lockedReason: "keyring" };
  if (error instanceof CredentialStoreError && (error.code === "locked" || error.code === "unavailable")) return { status: "locked" };
  return { status: "login-required" };
}

export type LoginManagerOptions = Readonly<{
  clientId: string;
  deploymentId: string;
  redirectUri?: string;
  allowLoopbackBrowserUrl?: boolean;
  attempts?: LoginAttemptStore;
  browser: SystemBrowserLauncher;
  transport: AuthTransport;
  credentials: CredentialStore;
  now?: () => number;
  logger?: (event: Readonly<Record<string, string>>) => void;
  onMetadata?: (metadata: LoginSessionMetadata) => void;
  onGenerationChange?: (generation: number) => void;
  clearQueryCache?: () => void;
  clearPlaintext?: () => void;
}>;

export type LoginStartResult = Readonly<{ status: "pending"; attemptId: string; expiresAt: number }>;
export type LoginCallbackResult =
  | Readonly<{ ok: true; metadata: LoginSessionMetadata }>
  | Readonly<{ ok: false; reason: CallbackRejectReason | "exchange_failed" | "browser_failed" | "store_locked" | "login_required" }>;

export class NativeLoginManager {
  private readonly options: LoginManagerOptions;
  private readonly attempts: LoginAttemptStore;
  private metadata: LoginSessionMetadata = Object.freeze({ status: "signed-out" });
  private generation = 1;
  private refreshInFlight?: Promise<LoginSessionMetadata>;

  constructor(options: LoginManagerOptions) {
    const redirectUri = options.redirectUri ?? DESKTOP_IDENTITY.authCallback;
    const registeredCallbacks = Object.values(DESKTOP_IDENTITY_MANIFEST.channelProfiles).map((profile) => profile.authCallback);
    if (!registeredCallbacks.includes(redirectUri)) throw new Error("Only the registered desktop callback is allowed");
    // Copy configuration so callers cannot mutate the identity binding after construction.
    this.options = Object.freeze({ ...options, redirectUri });
    this.attempts = this.options.attempts ?? new LoginAttemptStore();
  }

  getMetadata(): LoginSessionMetadata { return this.metadata; }
  getBinding(): Readonly<{ clientId: string; deploymentId: string }> { return { clientId: this.options.clientId, deploymentId: this.options.deploymentId }; }
  getGeneration(): number { return this.generation; }
  isBound(clientId: string, deploymentId: string): boolean { return clientId === this.options.clientId && deploymentId === this.options.deploymentId; }
  getCurrentAttempt(now = this.clock()): PendingLoginAttempt | undefined { return this.attempts.current(now); }

  async startLogin(): Promise<LoginStartResult> {
    const attempt = this.attempts.begin({ clientId: this.options.clientId, deploymentId: this.options.deploymentId, redirectUri: this.options.redirectUri ?? DESKTOP_IDENTITY.authCallback, now: this.clock() });
    this.setMetadata({ status: "pending" });
    const generation = this.generation;
    try {
      const response = await this.options.transport.start({ clientId: attempt.clientId, codeChallenge: attempt.codeChallenge, codeChallengeMethod: "S256", state: attempt.state, redirectUri: attempt.redirectUri, deploymentId: attempt.deploymentId, deviceLabel: `UniWork Office (${process.platform})`, platform: process.platform, build: DESKTOP_IDENTITY_MANIFEST.build.buildId });
      const authorizationUrl = new URL(response.authorizationUrl);
      const loopback = authorizationUrl.hostname === "localhost" || authorizationUrl.hostname === "127.0.0.1" || authorizationUrl.hostname === "[::1]";
      if (authorizationUrl.protocol !== "https:" && !(this.options.allowLoopbackBrowserUrl && authorizationUrl.protocol === "http:" && loopback)) throw new Error("Authorization URL must use HTTPS");
      await this.options.browser.open(response.authorizationUrl);
      if (generation !== this.generation) throw new Error("login scope changed");
    } catch {
      // A deployment/account switch can cancel this request while the start
      // endpoint or browser is still in flight.  Its late failure must not
      // overwrite the state of the new generation.
      const current = this.attempts.current(this.clock());
      if (generation === this.generation && current?.attemptId === attempt.attemptId) {
        this.attempts.cancel(attempt.attemptId);
        this.setMetadata({ status: "signed-out" });
        this.options.logger?.({ event: "auth_browser_start_failed", attemptId: attempt.attemptId });
      }
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
    const generation = this.generation;
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
      if (generation !== this.generation) return { ok: false, reason: "no_attempt" };
      if (session.deploymentId !== this.options.deploymentId) throw new Error("Auth exchange deployment mismatch");
      try { await this.options.credentials.save(toCredentialSession(session)); }
      catch (error) {
        const metadata = credentialFailureMetadata(error);
        this.setMetadata(metadata);
        const locked = metadata.status === "locked";
        this.options.logger?.({ event: "auth_credential_store_failed", attemptId: claimed.attemptId, reason: metadata.lockedReason === "keyring" ? "keyring_required" : locked ? "locked" : "corrupt" });
        return { ok: false, reason: locked ? "store_locked" : "login_required" };
      }
      this.setMetadata({ status: "signed-in", accountId: session.accountId, deploymentId: session.deploymentId });
      return { ok: true, metadata: this.metadata };
    } catch (error) {
      if (generation !== this.generation) return { ok: false, reason: "no_attempt" };
      this.setMetadata({ status: "signed-out" });
      if (error instanceof AuthTransportError && (error.code === "device_revoked" || error.code === "refresh_reused")) {
        this.setMetadata({ status: "login-required" });
        return { ok: false, reason: "login_required" };
      }
      this.options.logger?.({ event: "auth_exchange_failed", attemptId: claimed.attemptId });
      return { ok: false, reason: "exchange_failed" };
    }
  }

  /** Rehydrates metadata after a restart. Token bytes never leave this main
   * process; store failures become an explicit locked/login-required state. */
  async restore(): Promise<LoginSessionMetadata> {
    try {
      const session = await this.options.credentials.get();
      if (!session) { this.setMetadata({ status: "signed-out" }); return this.metadata; }
      if (session.accountId.length === 0) throw new CredentialStoreError("corrupt");
      this.setMetadata({ status: "signed-in", accountId: session.accountId, deploymentId: this.options.deploymentId });
    } catch (error) {
      this.setMetadata(credentialFailureMetadata(error));
    }
    return this.metadata;
  }

  /** Refresh is serialized per manager/session. Reuse or revocation signs out
   * immediately; callers never receive the raw pair. */
  async refreshSession(): Promise<LoginSessionMetadata> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const run = async () => {
      const generation = this.generation;
      try {
        const current = await this.options.credentials.get();
        if (!current || !this.options.transport.refresh) { this.setMetadata({ status: "login-required" }); return this.metadata; }
        const next = await this.options.transport.refresh({ deviceSessionId: current.deviceSessionId, refreshToken: current.refreshToken, deploymentId: this.options.deploymentId });
        if (generation !== this.generation) return this.metadata;
        await this.options.credentials.save(toCredentialSession(next));
        this.setMetadata({ status: "signed-in", accountId: next.accountId, deploymentId: next.deploymentId });
      } catch (error) {
        // The scope may have changed while the refresh request was pending.
        // Do not clear the new account's credentials or replace its metadata
        // with the old request's failure state.
        if (generation !== this.generation) return this.metadata;
        await this.clearCredentials();
        if (error instanceof AuthTransportError && error.code === "device_revoked") this.setMetadata({ status: "login-required" });
        else if (error instanceof AuthTransportError && error.code === "refresh_reused") this.setMetadata({ status: "login-required" });
        else this.setMetadata(credentialFailureMetadata(error));
      }
      return this.metadata;
    };
    const runPromise = run();
    const tracked = runPromise.finally(() => {
      // An account switch can start a replacement refresh before this old
      // promise settles; only the owner may clear the in-flight slot.
      if (this.refreshInFlight === tracked) this.refreshInFlight = undefined;
    });
    this.refreshInFlight = tracked;
    return tracked;
  }

  async logout(scope: "device" | "family" = "device"): Promise<LoginSessionMetadata> {
    const generation = this.generation;
    let current: CredentialSession | undefined;
    try { current = await this.options.credentials.get(); } catch { current = undefined; }
    try {
      if (current && this.options.transport.logout) {
        await this.options.transport.logout({ deviceSessionId: current.deviceSessionId, deploymentId: this.options.deploymentId, scope }, current.accessToken);
      }
    } catch (error) {
      if (generation !== this.generation) return this.metadata;
      // A timeout/network failure does not prove that the server revoked the
      // device. Keep the usable pair so a retry can complete logout. The
      // server-confirmed unauthorized case is terminal and must sign out.
      if (!(error instanceof AuthTransportError) || error.code !== "unauthorized") throw error;
    }
    if (generation !== this.generation) return this.metadata;
    await this.clearCredentials();
    this.setMetadata({ status: "signed-out" });
    return this.metadata;
  }

  /** Account/deployment switches invalidate all work from the previous scope.
   * Draft key material is intentionally owned elsewhere and is not cleared. */
  async switchScope(_scope: Readonly<{ accountId?: string; deploymentId?: string }>): Promise<number> {
    this.generation += 1;
    this.attempts.cancel();
    this.refreshInFlight = undefined;
    this.options.clearPlaintext?.();
    this.options.clearQueryCache?.();
    await this.clearCredentials();
    this.setMetadata({ status: "signed-out" });
    this.options.onGenerationChange?.(this.generation);
    return this.generation;
  }

  private async clearCredentials(): Promise<void> {
    try { await this.options.credentials.clear(); } catch { /* state remains login-required */ }
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
