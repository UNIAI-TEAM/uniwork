// The phone's own small choices (the theme and the language of Settings), in
// the Keychain/Keystore beside the session. One reader and one writer for all
// of them, so each is stored the same way: readable after the first unlock (a
// headless call task on a locked phone reads the language for its ringing
// notification, data/app-locale.ts) and written one at a time. They belong to
// the device, not the account: sign-out and account deletion keep them
// (data/local-wipe.ts).
import * as SecureStore from "expo-secure-store";
import { settled } from "@/lib/settled";

const KEYS = {
  theme: "theme-preference",
  locale: "locale_preference",
} as const;

export type DevicePreference = keyof typeof KEYS;

const ACCESS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

let writes: Promise<unknown> = Promise.resolve();

/** The saved choice, or null when none was saved. Rejects when the store cannot be read. */
export function readDevicePreference(name: DevicePreference): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS[name], ACCESS);
}

/** Saves the choice after any write before it; rejects when this one fails. */
export function writeDevicePreference(name: DevicePreference, value: string): Promise<void> {
  const result = writes.then(() => SecureStore.setItemAsync(KEYS[name], value, ACCESS));
  // The next write only waits its turn; this one's outcome is its caller's.
  writes = settled(result);
  return result;
}
