// Ported from apps/chat-desktop/src/main/auth/session.ts. Differences: the
// whole session (access token included) lives in the Keychain so a relaunch
// needs no refresh while the token is fresh; the browser is a modal system
// auth session that returns the callback URL; results that land after logout
// are dropped by the shared session epoch instead of a private generation
// counter, so the Keychain's conditional write and this class agree; no
// proactive refresh timer (M2a), a token is refreshed when asked for.
import { currentSessionEpoch, invalidateSessionEpoch, sessionEpochChanged } from "../session-epoch";
import { validateCallback } from "./callback";
import { LoginAttemptStore } from "./pkce";
import { TransportError, type DesktopSession, type Transport } from "./transport";

export type SessionState = "signed-out" | "signing-in" | "signed-in" | "refreshing" | "server-unreachable";

/** what the Keychain holds: the native session with absolute expiries (epoch ms) */
export interface StoredSession {
  access_token: string;
  refresh_token: string;
  device_session_id: string;
  deployment_id: string;
  expires_at: number;
  refresh_expires_at: number;
}

export interface SessionStorage {
  load(): Promise<StoredSession | null>;
  clear(): Promise<void>;
  /**
   * Conditional write: false (nothing written) when the epoch moved or, when
   * `previousRefreshToken` is given, the stored refresh token is another one.
   */
  commit(next: StoredSession, expected: { epoch: number; previousRefreshToken?: string }): Promise<boolean>;
}

export interface MobileSessionConfig {
  clientId: string;
  deploymentId: string;
  redirectUri: string;
  /** the `platform` the server records for the device: ios | android */
  platform: string;
  deviceLabel: string;
}

export interface MobileSessionDeps {
  config: MobileSessionConfig;
  transport: Transport;
  storage: SessionStorage;
  /** opens the system auth session; resolves to the callback URL, or null when the person dismissed it */
  openBrowser: (authorizationUrl: string, redirectUri: string) => Promise<string | null>;
  now?: () => number;
}

/** an access token this close to expiry is refreshed before use */
export const ACCESS_TOKEN_SKEW_MS = 30_000;
/** automatic retry after a transient failure: 5 s doubling up to 5 min */
export const RECOVERY_MIN_MS = 5_000;
const RECOVERY_MAX_MS = 300_000;
/** a 429's Retry-After is honoured up to this long */
export const RATE_LIMIT_WAIT_CAP_MS = 60_000;

/** refresh verdicts from the server itself after which the credential is dead */
const SESSION_ENDING: ReadonlySet<string> = new Set(["unauthorized", "device_revoked", "refresh_reused", "auth_code_invalid"]);

export function deviceLabel(os: string): string {
  return `UniChat (${os === "ios" ? "iOS" : os === "android" ? "Android" : os})`;
}

const codeOf = (error: unknown): string => (error instanceof TransportError ? error.code : "unknown");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Persisted = { ok: true } | { ok: false; code: string };

/**
 * Owner of the native session: PKCE sign-in through the system browser,
 * startup restore, the single in-flight refresh with bounded recovery, logout.
 * Tokens leave this object only through getAccessToken()/refresh()/onChange();
 * the refresh token only ever reaches the storage. Every async step captures
 * the session epoch and drops its result when logout moved on meanwhile.
 * Logs carry reason codes only, never a URL, code, state or token.
 */
export class MobileSession {
  private readonly deps: MobileSessionDeps;
  private readonly now: () => number;
  private readonly attempts = new LoginAttemptStore();
  private readonly listeners = new Set<(token: string | null) => void>();
  private state: SessionState = "signed-out";
  private live: StoredSession | null = null;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryAttempts = 0;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(deps: MobileSessionDeps) {
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

  /** Startup: the stored session of this deployment is adopted; a token near expiry is refreshed first. */
  async restore(): Promise<void> {
    let stored: StoredSession | null;
    try {
      stored = await this.deps.storage.load();
    } catch {
      console.warn("[auth] stored session unreadable");
      return;
    }
    if (!stored) return;
    if (stored.deployment_id !== this.deps.config.deploymentId) {
      // a session issued by another deployment is never sent to this one
      console.warn("[auth] stored session belongs to another deployment");
      return;
    }
    this.live = stored;
    if (this.isFresh(stored)) {
      this.adopt(stored);
      return;
    }
    this.state = "refreshing";
    await this.refresh();
  }

  /**
   * The whole browser sign-in: PKCE start, the system auth session, the code
   * exchange. A tap while one is running (browser open or exchange on the
   * wire) is a no-op. Rejects when start or the browser fails.
   */
  async login(): Promise<void> {
    if (this.state === "signing-in" || this.state === "signed-in" || this.state === "refreshing") return;
    // a live but unreachable session is recovered, never shadowed by a second attempt
    if (this.live) {
      await this.refresh();
      return;
    }
    const { config, transport } = this.deps;
    const epoch = currentSessionEpoch();
    this.state = "signing-in";
    let attempt;
    let url: string;
    try {
      attempt = await this.attempts.begin({
        clientId: config.clientId,
        deploymentId: config.deploymentId,
        redirectUri: config.redirectUri,
        now: this.now(),
      });
      ({ authorizationUrl: url } = await transport.start({
        clientId: attempt.clientId,
        codeChallenge: attempt.codeChallenge,
        state: attempt.state,
        redirectUri: attempt.redirectUri,
        deviceLabel: config.deviceLabel,
        platform: config.platform,
      }));
    } catch (error) {
      if (!sessionEpochChanged(epoch)) this.cancelLogin(codeOf(error));
      throw error;
    }
    if (sessionEpochChanged(epoch)) return;
    let callbackUrl: string | null;
    try {
      callbackUrl = await this.deps.openBrowser(url, attempt.redirectUri);
    } catch (error) {
      if (!sessionEpochChanged(epoch)) this.cancelLogin("browser_failed");
      throw error;
    }
    // logout meanwhile, or a deep link already completed this very attempt
    if (sessionEpochChanged(epoch) || this.attempts.peek() !== attempt) return;
    if (callbackUrl === null) {
      this.cancelLogin("browser_dismissed");
      return;
    }
    await this.completeCallback(callbackUrl);
  }

  /** The custom-scheme callback: validated against the live attempt, then exchanged. */
  async completeCallback(url: string): Promise<void> {
    const attempt = this.attempts.peek();
    // a stray callback (e.g. after a relaunch lost the verifier) changes nothing
    if (!attempt) return;
    const validation = validateCallback(url, attempt, this.now());
    if (!validation.ok) {
      if (validation.reason === "expired") this.cancelLogin("login_timeout");
      // a forged, stale or foreign callback is discarded; the live attempt stays (anything can open a URL)
      else console.warn(`[auth] callback discarded: ${validation.reason}`);
      return;
    }
    // single use: the attempt leaves the store before the exchange call
    this.attempts.cancel();
    const epoch = currentSessionEpoch();
    let session: DesktopSession;
    try {
      session = await this.deps.transport.exchange({
        clientId: attempt.clientId,
        code: validation.code,
        codeVerifier: attempt.verifier,
        redirectUri: attempt.redirectUri,
      });
    } catch (error) {
      if (!sessionEpochChanged(epoch)) this.failLogin(codeOf(error));
      return;
    }
    if (sessionEpochChanged(epoch)) return;
    const next = this.storedOf(session);
    const persisted = await this.persist(next, { epoch });
    if (!persisted.ok) {
      // the device is redeemed server-side but unusable here: revoke it rather than orphan it
      void this.revoke(next);
      if (!sessionEpochChanged(epoch)) this.failLogin(persisted.code);
      return;
    }
    this.adopt(next);
  }

  /** A valid access token, refreshing if needed; null without a usable session. */
  async getAccessToken(): Promise<string | null> {
    if (!this.live) return null;
    if (this.isFresh(this.live)) return this.live.access_token;
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

  /** Signs out at once (the epoch moves first, synchronously); the device revoke goes out in the background. */
  async logout(): Promise<void> {
    invalidateSessionEpoch();
    this.attempts.cancel();
    const live = this.live;
    this.reset();
    if (live) {
      this.emit(null);
      void this.revoke(live);
    }
    await this.deps.storage.clear();
  }

  private async runRefresh(): Promise<string | null> {
    const live = this.live;
    if (!live) return null;
    const epoch = currentSessionEpoch();
    if (live.refresh_expires_at <= this.now()) {
      await this.endSession("refresh_expired");
      return null;
    }
    if (this.state === "signed-in") this.state = "refreshing";
    let next: DesktopSession;
    try {
      next = await this.refreshOnce(live);
    } catch (error) {
      if (sessionEpochChanged(epoch)) return null;
      if (error instanceof TransportError && error.fromServer && SESSION_ENDING.has(error.code)) {
        await this.endSession(error.code);
        return null;
      }
      console.warn(`[auth] refresh failed: ${codeOf(error)}`);
      this.state = "server-unreachable";
      this.scheduleRecovery();
      return null;
    }
    if (sessionEpochChanged(epoch)) return null;
    const rotated = this.storedOf(next);
    // rotation: the old refresh token is dead server-side, so the new one is in the Keychain before use
    const persisted = await this.persist(rotated, { epoch, previousRefreshToken: live.refresh_token });
    if (!persisted.ok) {
      // the rotated token is lost with this process: revoke the device instead of leaving it live
      void this.revoke(rotated);
      if (!sessionEpochChanged(epoch)) await this.endSession(persisted.code);
      return null;
    }
    this.adopt(rotated);
    return rotated.access_token;
  }

  /** one 429 is waited out (Retry-After, capped) and retried; a second one is a transient failure */
  private async refreshOnce(live: StoredSession): Promise<DesktopSession> {
    const request = { deviceSessionId: live.device_session_id, refreshToken: live.refresh_token };
    try {
      return await this.deps.transport.refresh(request);
    } catch (error) {
      if (!(error instanceof TransportError) || error.code !== "rate_limited") throw error;
      await sleep(Math.min(error.retryAfterMs ?? RECOVERY_MIN_MS, RATE_LIMIT_WAIT_CAP_MS));
      return this.deps.transport.refresh(request);
    }
  }

  private async revoke(session: StoredSession): Promise<void> {
    const { transport } = this.deps;
    try {
      let token = session.access_token;
      if (!this.isFresh(session)) {
        token = (
          await transport.refresh({ deviceSessionId: session.device_session_id, refreshToken: session.refresh_token })
        ).accessToken;
      }
      await transport.logout({ deviceSessionId: session.device_session_id }, token);
    } catch {
      // offline or already revoked: the server-side device expires on its own
    }
  }

  private isFresh(session: StoredSession): boolean {
    return session.expires_at - this.now() > ACCESS_TOKEN_SKEW_MS;
  }

  private storedOf(session: DesktopSession): StoredSession {
    const now = this.now();
    return {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      device_session_id: session.deviceSessionId,
      deployment_id: session.deploymentId,
      expires_at: now + session.expiresIn * 1000,
      refresh_expires_at: now + session.refreshExpiresIn * 1000,
    };
  }

  private adopt(session: StoredSession): void {
    this.live = session;
    this.clearRecoveryTimer();
    this.recoveryAttempts = 0;
    this.state = "signed-in";
    this.emit(session.access_token);
  }

  private async persist(next: StoredSession, expected: Parameters<SessionStorage["commit"]>[1]): Promise<Persisted> {
    try {
      return (await this.deps.storage.commit(next, expected)) ? { ok: true } : { ok: false, code: "stale" };
    } catch {
      return { ok: false, code: "storage_failed" };
    }
  }

  /** the credential is gone (server verdict or unstorable): move the epoch, sign out, tell the app, clear */
  private async endSession(reason: string): Promise<void> {
    console.warn(`[auth] session ended: ${reason}`);
    invalidateSessionEpoch();
    this.reset();
    this.emit(null);
    try {
      await this.deps.storage.clear();
    } catch {
      console.warn("[auth] stored session not cleared");
    }
  }

  /** only ever reached from `signing-in` */
  private failLogin(reason: string): void {
    console.warn(`[auth] sign-in failed: ${reason}`);
    this.state = "signed-out";
  }

  private cancelLogin(reason: string): void {
    this.attempts.cancel();
    this.failLogin(reason);
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

  /** drops the in-memory session and its timer (the Keychain is untouched) */
  private reset(): void {
    this.clearRecoveryTimer();
    this.live = null;
    this.state = "signed-out";
  }

  private emit(token: string | null): void {
    for (const listener of this.listeners) listener(token);
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }
}
