// The native session as the Keychain holds it (data/secure-storage.ts), and the arithmetic MobileSession
// (session.ts) does on it: absolute expiries from the server's relative ones, freshness, the conditional commit.
import type { DesktopSession } from "./transport";

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

/** an access token this close to expiry is refreshed before use */
export const ACCESS_TOKEN_SKEW_MS = 30_000;

/** The server's answer as the Keychain keeps it: its relative lifetimes counted from `now`. */
export function storedOf(session: DesktopSession, now: number): StoredSession {
  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    device_session_id: session.deviceSessionId,
    deployment_id: session.deploymentId,
    expires_at: now + session.expiresIn * 1000,
    refresh_expires_at: now + session.refreshExpiresIn * 1000,
  };
}

export function isFresh(session: StoredSession, now: number): boolean {
  return session.expires_at - now > ACCESS_TOKEN_SKEW_MS;
}

export type Persisted = { ok: true } | { ok: false; code: string };

/** The conditional commit, its refusal (`stale`) and its failure (`storage_failed`) told apart, never thrown. */
export async function persist(storage: SessionStorage, next: StoredSession, expected: Parameters<SessionStorage["commit"]>[1]): Promise<Persisted> {
  try {
    return (await storage.commit(next, expected)) ? { ok: true } : { ok: false, code: "stale" };
  } catch {
    return { ok: false, code: "storage_failed" };
  }
}
