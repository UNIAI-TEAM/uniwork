// The last signed-in person, kept in the Keychain beside the session (audit
// P0-3): a cold start with a stored credential routes on this copy at once and
// revalidates /me in the background, so a phone offline or a server answering
// 5xx opens the inbox instead of the sign-in screen. Written after every /me
// and PATCH /me, removed with the session. Writes go through one queue and are
// dropped once the session epoch moved, so a /me that lands after a sign-out
// cannot bring the person back.
import type { User } from "@uniwork/core/types/user";
import * as SecureStore from "expo-secure-store";
import { MeResponseSchema } from "../schemas";
import { sessionEpochChanged } from "../session-epoch";

const KEY = "uniwork_chat_last_user";
// Same class as the session: readable after the first unlock (a push can wake the app), never backed up.
const ACCESS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let writes: Promise<unknown> = Promise.resolve();

function serialize(operation: () => Promise<void>): Promise<void> {
  const result = writes.then(operation, operation);
  writes = result.catch(() => undefined);
  return result;
}

/** The stored person, or null when none (or it no longer parses: the app then waits for /me). */
export async function readLastUser(): Promise<User | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(KEY, ACCESS);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = MeResponseSchema.safeParse({ user: JSON.parse(raw) });
    return parsed.success ? parsed.data.user : null;
  } catch {
    return null;
  }
}

/** Keeps `user` for the next cold start, unless the session it was read under has ended since `epoch`. */
export function rememberUser(user: User, epoch: number): Promise<void> {
  return serialize(async () => {
    if (sessionEpochChanged(epoch)) return;
    await SecureStore.setItemAsync(KEY, JSON.stringify(user), ACCESS);
  }).catch(() => undefined);
}

export function forgetLastUser(): Promise<void> {
  return serialize(() => SecureStore.deleteItemAsync(KEY, ACCESS)).catch(() => undefined);
}
