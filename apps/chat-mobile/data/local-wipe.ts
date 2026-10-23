// What an account leaves on this phone, wiped in two sizes.
//
// wipeSessionTraces — every sign-out and every session the server ends
// (a revoked device, a reused refresh token; data/auth/store.ts ›
// forgetAccountLocally): the images expo-image cached from its conversations
// (the disk cache is not encrypted), the notifications still in the tray and
// the badge. A phone signed out after a loss or a theft keeps no photo and no
// message banner of the account.
//
// wipeDeviceTraces — an erased account (Settings › Delete account): the same,
// plus this device's push choice and the conversations it pinned in each
// workspace it belonged to. Those two stay on a plain sign-out: they are the
// person's choices on this phone and come back with the next sign-in.
//
// The session, the query cache, the workspace and the unsent bubbles go
// through useAuthStore (data/auth/store.ts). The theme and the language stay:
// they are this device's settings, not the account's data. Each step is best
// effort: one that fails must not keep the rest.
import { Image } from "expo-image";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { createLogger } from "./logger";
import { PUSH_PREF_KEY } from "./push";
import { pinsStorageKey } from "./stores/chat-pins-store";

const log = createLogger("local-wipe");

type Step = [string, () => Promise<unknown>];

const SESSION_STEPS: Step[] = [
  ["image_disk_cache", () => Image.clearDiskCache()],
  ["image_memory_cache", () => Image.clearMemoryCache()],
  ["notifications", () => Notifications.dismissAllNotificationsAsync()],
  ["badge", () => Notifications.setBadgeCountAsync(0)],
];

async function run(steps: Step[]): Promise<void> {
  const results = await Promise.allSettled(steps.map(([, step]) => step()));
  results.forEach((result, index) => {
    if (result.status === "rejected") log.warn("wipe step failed", { step: steps[index]![0] });
  });
}

export function wipeSessionTraces(): Promise<void> {
  return run(SESSION_STEPS);
}

export function wipeDeviceTraces(workspaceIds: readonly string[]): Promise<void> {
  return run([
    ...SESSION_STEPS,
    ["push_preference", () => SecureStore.deleteItemAsync(PUSH_PREF_KEY)],
    ...workspaceIds.map((id): Step => ["pins", () => SecureStore.deleteItemAsync(pinsStorageKey(id))]),
  ]);
}
