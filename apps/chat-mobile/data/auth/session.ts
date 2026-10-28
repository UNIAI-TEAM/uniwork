// Ported from apps/chat-desktop/src/main/auth/session.ts. Differences: the
// whole session (access token included) lives in the Keychain so a relaunch
// needs no refresh while the token is fresh; the browser is a modal system
// auth session that returns the callback URL; results that land after logout
// are dropped by the shared session epoch instead of a private generation
// counter, so the Keychain's conditional write and this class agree; no
// proactive refresh timer, a token is refreshed when asked for.
import { createLogger } from "../logger";
import { currentSessionEpoch, invalidateSessionEpoch, sessionEpochChanged } from "../session-epoch";
import { validateCallback } from "./callback";
import { LoginAttemptStore, type PendingLoginAttempt } from "./pkce";
import { RECOVERY_MIN_MS, RecoveryTimer } from "./recovery";
import { isFresh, persist, storedOf, type SessionStorage, type StoredSession } from "./stored-session";
import { TransportError, type DesktopSession, type Transport } from "./transport";

export type SessionState = "signed-out" | "signing-in" | "signed-in" | "refreshing" | "server-unreachable";

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

/** a 429's Retry-After is honoured up to this long */
export const RATE_LIMIT_WAIT_CAP_MS = 60_000;

/** refresh verdicts from the server itself after which the credential is dead */
const SESSION_ENDING: ReadonlySet<string> = new Set(["unauthorized", "device_revoked", "refresh_reused", "auth_code_invalid"]);

export function deviceLabel(os: string): string {
  return `UniChat (${os === "ios" ? "iOS" : os === "android" ? "Android" : os})`;
}

const log = createLogger("auth");

const codeOf = (error: unknown): string => (error instanceof TransportError ? error.code : "unknown");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  private readonly recovery = new RecoveryTimer();
  private refreshInFlight: Promise<string | null> | null = null;
  /** the exchange a deep link started while login() still waits on the browser */
  private completing: Promise<void> | null = null;

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

  /**
   * Startup: the stored session of this deployment is adopted; a token near
   * expiry is refreshed. Resolves to whether a credential is held. A cold
   * start passes `awaitRefresh: false`: it routes on the stored credential at
   * once (offline, a 5xx) and lets the refresh land in the background; the
   * credential goes only on a server verdict (onChange(null)).
   */
  async restore(options: { awaitRefresh?: boolean } = {}): Promise<boolean> {
    let stored: StoredSession | null;
    try {
      stored = await this.deps.storage.load();
    } catch {
      log.warn("stored session unreadable");
      return false;
    }
    if (!stored) return false;
    if (stored.deployment_id !== this.deps.config.deploymentId) {
      // a session issued by another deployment is never sent to this one
      log.warn("stored session belongs to another deployment");
      return false;
    }
    this.live = stored;
    if (isFresh(stored, this.now())) {
      this.adopt(stored);
      return true;
    }
    this.state = "refreshing";
    const refreshing = this.refresh();
    if (options.awaitRefresh !== false) await refreshing;
    return this.live !== null;
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
      // a deep link may already have completed this very attempt: that session stays
      if (!sessionEpochChanged(epoch) && this.attempts.peek() === attempt) this.cancelLogin("browser_failed");
      throw error;
    }
    if (sessionEpochChanged(epoch)) return;
    // a deep link already took this attempt: login() settles once its exchange has adopted the session
    if (this.attempts.peek() !== attempt) {
      await this.completing;
      return;
    }
    if (callbackUrl === null) {
      // Android can report dismiss while the redirect still arrives via Linking: the attempt stays for it
      this.failLogin("browser_dismissed");
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
      else log.warn("callback discarded", { reason: validation.reason });
      return;
    }
    // single use: the attempt leaves the store before the exchange call
    this.attempts.cancel();
    this.completing = this.exchange(attempt, validation.code);
    return this.completing;
  }

  private async exchange(attempt: PendingLoginAttempt, code: string): Promise<void> {
    const epoch = currentSessionEpoch();
    let session: DesktopSession;
    try {
      session = await this.deps.transport.exchange({
        clientId: attempt.clientId,
        code,
        codeVerifier: attempt.verifier,
        redirectUri: attempt.redirectUri,
      });
    } catch (error) {
      if (!sessionEpochChanged(epoch)) this.failLogin(codeOf(error));
      return;
    }
    if (sessionEpochChanged(epoch)) return;
    await this.adoptIssued(session, epoch);
  }

  /**
   * A sign-in that issues the session without the browser (Sign in with Apple, apple-transport.ts › appleIssuer):
   * `issue` answers null when the person closed it, and is told when a sign-out moved on meanwhile. A failure rejects,
   * a server verdict with its TransportError, for the screen to explain.
   */
  async loginWith(issue: (stale: () => boolean) => Promise<DesktopSession | null>): Promise<void> {
    if (this.state === "signing-in" || this.state === "signed-in" || this.state === "refreshing") return;
    if (this.live) {
      await this.refresh();
      return;
    }
    const epoch = currentSessionEpoch();
    this.state = "signing-in";
    let session: DesktopSession | null;
    try {
      session = await issue(() => sessionEpochChanged(epoch));
    } catch (error) {
      if (!sessionEpochChanged(epoch)) this.failLogin(codeOf(error));
      throw error;
    }
    if (sessionEpochChanged(epoch)) return;
    if (session) await this.adoptIssued(session, epoch);
    else this.failLogin("dismissed");
  }

  /** A session the server just issued: into the Keychain, then live. */
  private async adoptIssued(session: DesktopSession, epoch: number): Promise<void> {
    const next = storedOf(session, this.now());
    const persisted = await persist(this.deps.storage, next, { epoch });
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
    if (isFresh(this.live, this.now())) return this.live.access_token;
    return this.refresh();
  }

  /** Single in-flight refresh; resolves to the new access token, or null when none could be had. */
  refresh(): Promise<string | null> {
    if (!this.refreshInFlight) {
      const run: Promise<string | null> = this.runRefresh().finally(() => {
        // reset() may have dropped it and a later account started its own
        if (this.refreshInFlight === run) this.refreshInFlight = null;
      });
      this.refreshInFlight = run;
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
    try {
      await this.deps.storage.clear();
    } catch {
      log.warn("stored session not cleared");
    }
  }

  /**
   * The first launch of a fresh install (data/install-marker.ts): iOS keeps Keychain items after the app is
   * deleted, so a session stored by the previous install is still there. It is never adopted: storage is cleared
   * and its device revoked in the background, so deleting the app also signs it out. Nothing is emitted, since no
   * one was signed in on this install.
   */
  async discardStored(): Promise<void> {
    invalidateSessionEpoch();
    let previous: StoredSession | null = null;
    try {
      previous = await this.deps.storage.load();
    } catch {
      // unreadable: cleared below all the same
    }
    try {
      await this.deps.storage.clear();
    } catch {
      log.warn("stored session not cleared");
    }
    if (previous) void this.revoke(previous);
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
      log.warn("refresh failed", { code: codeOf(error) });
      this.state = "server-unreachable";
      this.recovery.schedule(() => void this.refresh());
      return null;
    }
    if (sessionEpochChanged(epoch)) return null;
    const rotated = storedOf(next, this.now());
    // rotation: the old refresh token is dead server-side, so the new one is in the Keychain before use
    const persisted = await persist(this.deps.storage, rotated, { epoch, previousRefreshToken: live.refresh_token });
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
      if (!isFresh(session, this.now())) {
        token = (
          await transport.refresh({ deviceSessionId: session.device_session_id, refreshToken: session.refresh_token })
        ).accessToken;
      }
      await transport.logout({ deviceSessionId: session.device_session_id }, token);
    } catch {
      // offline or already revoked: the server-side device expires on its own
    }
  }

  private adopt(session: StoredSession): void {
    this.live = session;
    this.recovery.reset();
    this.state = "signed-in";
    this.emit(session.access_token);
  }

  /** the credential is gone (server verdict or unstorable): move the epoch, sign out, tell the app, clear */
  private async endSession(reason: string): Promise<void> {
    log.warn("session ended", { reason });
    invalidateSessionEpoch();
    this.reset();
    this.emit(null);
    try {
      await this.deps.storage.clear();
    } catch {
      log.warn("stored session not cleared");
    }
  }

  /** only ever reached from `signing-in` */
  private failLogin(reason: string): void {
    log.warn("sign-in failed", { reason });
    this.state = "signed-out";
  }

  private cancelLogin(reason: string): void {
    this.attempts.cancel();
    this.failLogin(reason);
  }

  /** drops the in-memory session and its timer (the Keychain is untouched) */
  private reset(): void {
    this.recovery.clear();
    this.live = null;
    // a hung refresh of this session must not be handed to the next one
    this.refreshInFlight = null;
    this.state = "signed-out";
  }

  private emit(token: string | null): void {
    for (const listener of this.listeners) listener(token);
  }
}
