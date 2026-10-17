import type { ShellConfig } from "../runtime-config";
import { validateCallback } from "./callback";
import { CredentialStoreError, type CredentialStore, type StoredCredential } from "./credentials";
import { LoginAttemptStore } from "./pkce";
import { TransportError, type DesktopSession, type Transport } from "./transport";

export type SessionState = "signed-out" | "signing-in" | "signed-in" | "refreshing" | "server-unreachable";

export interface ShellSessionDeps {
  config: ShellConfig;
  transport: Transport;
  credentials: CredentialStore;
  /** opens the validated authorization URL in the system browser */
  openBrowser: (url: string) => Promise<void>;
  now?: () => number;
}

/** refresh proactively at this share of the access token lifetime */
const PROACTIVE_REFRESH_RATIO = 0.8;
/** an access token this close to expiry is refreshed before use */
export const ACCESS_TOKEN_SKEW_MS = 30_000;
/** automatic retry after a transient failure: 5 s doubling up to 5 min */
export const RECOVERY_MIN_MS = 5_000;
const RECOVERY_MAX_MS = 300_000;
/** a 429's Retry-After is honoured up to this long */
export const RATE_LIMIT_WAIT_CAP_MS = 60_000;
/** setTimeout fires at once past 2^31-1 ms, so longer delays are clamped */
const MAX_TIMER_MS = 2_147_483_647;

/** refresh verdicts from the server itself after which the credential is dead */
const SESSION_ENDING: ReadonlySet<string> = new Set(["unauthorized", "device_revoked", "refresh_reused", "auth_code_invalid"]);

export function deviceLabel(platform: NodeJS.Platform = process.platform): string {
  const os = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : "Linux";
  return `UniChat (${os})`;
}

const codeOf = (error: unknown): string =>
  error instanceof TransportError || error instanceof CredentialStoreError ? error.code : "unknown";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface LiveSession {
  credential: StoredCredential;
  accessToken: string;
  accessExpiresAt: number;
}

/**
 * Main-process owner of the desktop session: PKCE sign-in and its callback,
 * startup restore, the single in-flight refresh with its proactive timer and
 * bounded recovery, logout. Tokens never leave this object except the access
 * token through getAccessToken()/refresh()/onChange(); the refresh token only
 * ever reaches the credential store. Every async step captures the generation
 * and drops its result when logout or a new sign-in moved on meanwhile.
 * Logs carry reason codes only, never a URL, code, state or token.
 */
export class ShellSession {
  private readonly deps: ShellSessionDeps;
  private readonly now: () => number;
  private readonly attempts = new LoginAttemptStore();
  private readonly listeners = new Set<(token: string | null) => void>();
  private state: SessionState = "signed-out";
  private live: LiveSession | null = null;
  private generation = 0;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryAttempts = 0;
  private refreshInFlight: Promise<string | null> | null = null;
  /** the callback's code exchange is on the wire: a login() meanwhile would discard its result */
  private exchanging = false;

  constructor(deps: ShellSessionDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  status(): SessionState {
    return this.state;
  }

  onChange(cb: (token: string | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Startup: a stored credential of this deployment is refreshed; `refreshing` until the server answers. */
  async restore(): Promise<void> {
    let credential: StoredCredential | null;
    try {
      credential = this.deps.credentials.load();
    } catch (error) {
      console.warn(`[auth] stored session unreadable: ${codeOf(error)}`);
      return;
    }
    if (!credential) return;
    const { config } = this.deps;
    if (
      credential.deploymentId !== config.deploymentId ||
      credential.apiOrigin !== config.apiUrl ||
      credential.clientId !== config.clientId
    ) {
      // a credential issued by another deployment is never sent to this one
      console.warn("[auth] stored session belongs to another deployment");
      return;
    }
    this.live = { credential, accessToken: "", accessExpiresAt: 0 };
    this.state = "refreshing";
    await this.refresh();
  }

  /** Starts the browser sign-in; resolves once the browser is open. Rejects when it cannot start. */
  async login(): Promise<void> {
    if (this.state === "signed-in" || this.state === "refreshing" || this.exchanging) return;
    // a live but unreachable session is recovered, never shadowed by a second attempt
    if (this.live) {
      await this.refresh();
      return;
    }
    const current = this.attempts.current(this.now());
    if (current) {
      // a click while the browser sign-in is open re-opens that page: a new
      // attempt would turn the open tab's callback into a state mismatch
      if (current.authorizationUrl) await this.deps.openBrowser(current.authorizationUrl);
      return;
    }
    // no encrypted store (Linux basic_text): a redeemed code would orphan a device
    if (!this.deps.credentials.canStore()) {
      console.warn("[auth] login refused: keyring_unavailable");
      throw new CredentialStoreError("keyring_unavailable");
    }
    const { config, transport } = this.deps;
    const generation = ++this.generation;
    this.clearAttemptTimer();
    const attempt = this.attempts.begin({
      clientId: config.clientId,
      deploymentId: config.deploymentId,
      redirectUri: config.redirectUri,
      now: this.now(),
    });
    this.state = "signing-in";
    let url: string;
    try {
      ({ authorizationUrl: url } = await transport.start({
        clientId: attempt.clientId,
        codeChallenge: attempt.codeChallenge,
        state: attempt.state,
        redirectUri: attempt.redirectUri,
        deviceLabel: deviceLabel(),
        platform: process.platform,
      }));
    } catch (error) {
      if (generation === this.generation) {
        this.attempts.cancel();
        this.failLogin(codeOf(error));
      }
      throw error;
    }
    if (generation !== this.generation) return;
    attempt.authorizationUrl = url;
    this.attemptTimer = setTimeout(() => this.expireAttempt(), attempt.expiresAt - this.now());
    // a browser that fails to open leaves the attempt live: the next login() re-opens the same page
    await this.deps.openBrowser(url);
  }

  /** The custom-scheme callback: validated against the live attempt, then exchanged. */
  async completeCallback(url: string): Promise<void> {
    const attempt = this.attempts.peek();
    // a stray callback (e.g. after a restart lost the verifier) changes nothing
    if (!attempt) return;
    const validation = validateCallback(url, attempt, this.now());
    if (!validation.ok) {
      if (validation.reason === "expired") this.expireAttempt();
      // a forged, stale or foreign callback is discarded; the live attempt stays (anything can open a URL)
      else console.warn(`[auth] callback discarded: ${validation.reason}`);
      return;
    }
    // single use: the attempt leaves the store before the exchange call
    this.clearAttemptTimer();
    this.attempts.cancel();
    const generation = this.generation;
    const { config, transport } = this.deps;
    let session: DesktopSession;
    this.exchanging = true;
    try {
      session = await transport.exchange({
        clientId: attempt.clientId,
        code: validation.code,
        codeVerifier: attempt.verifier,
        redirectUri: attempt.redirectUri,
      });
    } catch (error) {
      if (generation === this.generation) this.failLogin(codeOf(error));
      return;
    } finally {
      this.exchanging = false;
    }
    if (generation !== this.generation) return;
    const credential: StoredCredential = {
      deploymentId: config.deploymentId,
      apiOrigin: config.apiUrl,
      clientId: config.clientId,
      accountId: session.accountId,
      deviceSessionId: session.deviceSessionId,
      sessionId: session.sessionId,
      refreshToken: session.refreshToken,
      refreshExpiresAt: this.now() + session.refreshExpiresIn * 1000,
    };
    const stored = this.persist(credential);
    if (!stored.ok) {
      // the device is redeemed server-side but unusable here: revoke it rather than orphan it
      void this.revoke(this.liveOf(credential, session));
      this.failLogin(stored.code);
      return;
    }
    this.adopt(credential, session);
  }

  /** A valid access token, refreshing if needed; null without a usable session. */
  async getAccessToken(): Promise<string | null> {
    if (!this.live) return null;
    if (this.live.accessExpiresAt - this.now() > ACCESS_TOKEN_SKEW_MS) return this.live.accessToken;
    return this.refresh();
  }

  /** Single in-flight refresh; resolves to the new access token, or null when none could be had. */
  refresh(): Promise<string | null> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.runRefresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  /** Signs out at once; the device revoke goes out in the background. */
  async logout(): Promise<void> {
    this.generation++;
    this.attempts.cancel();
    this.clearAttemptTimer();
    const live = this.live;
    this.deps.credentials.clear();
    this.reset();
    if (!live) return;
    this.emit(null);
    void this.revoke(live);
  }

  private async runRefresh(): Promise<string | null> {
    const live = this.live;
    if (!live) return null;
    const generation = this.generation;
    if (live.credential.refreshExpiresAt <= this.now()) {
      this.endSession("refresh_expired");
      return null;
    }
    if (this.state === "signed-in") this.state = "refreshing";
    let next: DesktopSession;
    try {
      next = await this.refreshOnce(live.credential);
    } catch (error) {
      if (generation !== this.generation) return null;
      if (error instanceof TransportError && error.fromServer && SESSION_ENDING.has(error.code)) {
        this.endSession(error.code);
        return null;
      }
      console.warn(`[auth] refresh failed: ${codeOf(error)}`);
      this.state = "server-unreachable";
      this.scheduleRecovery();
      return null;
    }
    if (generation !== this.generation) return null;
    const credential: StoredCredential = {
      ...live.credential,
      deviceSessionId: next.deviceSessionId,
      sessionId: next.sessionId,
      refreshToken: next.refreshToken,
      refreshExpiresAt: this.now() + next.refreshExpiresIn * 1000,
    };
    // rotation: the old refresh token is dead server-side, so the new one is on disk before use
    const stored = this.persist(credential);
    if (!stored.ok) {
      // the rotated token is lost with this process: revoke the device instead of leaving it live
      void this.revoke(this.liveOf(credential, next));
      this.endSession(stored.code);
      return null;
    }
    this.adopt(credential, next);
    return next.accessToken;
  }

  /** one 429 is waited out (Retry-After, capped) and retried; a second one is a transient failure */
  private async refreshOnce(credential: StoredCredential): Promise<DesktopSession> {
    const request = { deviceSessionId: credential.deviceSessionId, refreshToken: credential.refreshToken };
    try {
      return await this.deps.transport.refresh(request);
    } catch (error) {
      if (!(error instanceof TransportError) || error.code !== "rate_limited") throw error;
      await sleep(Math.min(error.retryAfterMs ?? RECOVERY_MIN_MS, RATE_LIMIT_WAIT_CAP_MS));
      return this.deps.transport.refresh(request);
    }
  }

  private async revoke(live: LiveSession): Promise<void> {
    const { transport } = this.deps;
    try {
      let token = live.accessToken;
      if (live.accessExpiresAt <= this.now()) {
        token = (
          await transport.refresh({
            deviceSessionId: live.credential.deviceSessionId,
            refreshToken: live.credential.refreshToken,
          })
        ).accessToken;
      }
      await transport.logout({ deviceSessionId: live.credential.deviceSessionId }, token);
    } catch {
      // offline or already revoked: the server-side device expires on its own
    }
  }

  private liveOf(credential: StoredCredential, session: DesktopSession): LiveSession {
    return { credential, accessToken: session.accessToken, accessExpiresAt: this.now() + session.expiresIn * 1000 };
  }

  private adopt(credential: StoredCredential, session: DesktopSession): void {
    this.live = this.liveOf(credential, session);
    this.clearRefreshTimer();
    this.clearRecoveryTimer();
    this.recoveryAttempts = 0;
    this.state = "signed-in";
    const delay = Math.min(MAX_TIMER_MS, Math.max(1000, session.expiresIn * 1000 * PROACTIVE_REFRESH_RATIO));
    this.refreshTimer = setTimeout(() => void this.refresh(), delay);
    this.emit(session.accessToken);
  }

  private persist(credential: StoredCredential): { ok: true } | { ok: false; code: string } {
    try {
      this.deps.credentials.save(credential);
      return { ok: true };
    } catch (error) {
      return { ok: false, code: codeOf(error) };
    }
  }

  /** the credential is gone (server verdict or unstorable): clear, sign out, tell the renderer */
  private endSession(reason: string): void {
    console.warn(`[auth] session ended: ${reason}`);
    this.deps.credentials.clear();
    this.reset();
    this.emit(null);
  }

  /** only ever reached from `signing-in`: every caller holds the live attempt */
  private failLogin(reason: string): void {
    console.warn(`[auth] sign-in failed: ${reason}`);
    this.state = "signed-out";
  }

  /** the timer is cleared whenever the attempt changes, so this always ends the live one */
  private expireAttempt(): void {
    this.attempts.cancel();
    this.generation++;
    this.clearAttemptTimer();
    this.failLogin("login_timeout");
  }

  /** server-unreachable with a credential retries on its own, with a bounded backoff */
  private scheduleRecovery(): void {
    if (this.recoveryTimer) return;
    const delay = Math.min(RECOVERY_MAX_MS, RECOVERY_MIN_MS * 2 ** this.recoveryAttempts);
    this.recoveryAttempts = Math.min(this.recoveryAttempts + 1, 16);
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.refresh();
    }, delay);
  }

  /** drops the in-memory session and its timers (the disk credential is untouched) */
  private reset(): void {
    this.clearRefreshTimer();
    this.clearRecoveryTimer();
    this.live = null;
    this.state = "signed-out";
  }

  private emit(token: string | null): void {
    for (const listener of this.listeners) listener(token);
  }

  private clearAttemptTimer(): void {
    if (this.attemptTimer) clearTimeout(this.attemptTimer);
    this.attemptTimer = null;
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }
}
