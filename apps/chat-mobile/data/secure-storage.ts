// Ported from usf apps/mobile/data/secure-storage.ts: one serialized writer
// for the Keychain value, with a conditional commit decided inside the queue.
// The value is the whole native session (access + rotating refresh token), so
// a relaunch needs no refresh while the access token is still good.
import * as SecureStore from "expo-secure-store";
import type { SessionStorage, StoredSession } from "./auth/session";
import { sessionEpochChanged } from "./session-epoch";

const SESSION_KEY = "uniwork_chat_session";
// the default (WHEN_UNLOCKED) makes a refresh landing while the phone is locked fail to persist
const ACCESS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

// Tail of the write queue. Each operation chains onto the previous one so no
// two can be in flight at once; failures do not stall the queue.
let writes: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation, operation);
  writes = result.catch(() => undefined);
  return result;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    ["access_token", "refresh_token", "device_session_id", "deployment_id"].every(
      (key) => typeof v[key] === "string" && (v[key] as string).length > 0,
    ) && ["expires_at", "refresh_expires_at"].every((key) => typeof v[key] === "number" && Number.isFinite(v[key]))
  );
}

async function read(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY, ACCESS);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isStoredSession(parsed) ? parsed : null;
}

export type { StoredSession };

export const secureSessionStorage: SessionStorage = {
  load: read,

  clear: () => serialize(() => SecureStore.deleteItemAsync(SESSION_KEY, ACCESS)),

  /**
   * Persist a session, but only if the one it replaces is still the one the
   * app is using. The check and the write are one serialized unit: a logout
   * or a sign-in cannot land between them. The epoch catches a teardown that
   * has STARTED but not finished (its delete is still in flight, so a read
   * would still return the old session); the refresh-token comparison, when
   * asked for, catches a credential replaced by any path that did not move
   * the epoch.
   */
  commit: (next, expected) =>
    serialize(async () => {
      if (sessionEpochChanged(expected.epoch)) return false;
      if (expected.previousRefreshToken !== undefined) {
        const current = await read();
        if (current?.refresh_token !== expected.previousRefreshToken) return false;
      }
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next), ACCESS);
      return true;
    }),
};
