// What an erased account leaves on this phone, wiped (Settings › Delete
// account): the images expo-image cached from its conversations, the
// notifications still in the tray and the badge, this device's push choice,
// and the conversations it pinned in each workspace it belonged to. The
// session, the query cache, the workspace and the unsent bubbles go through
// useAuthStore.accountDeleted() (data/auth/store.ts). The theme and the
// language stay: they are this device's settings, not the account's data.
// Each step is best effort: one that fails must not keep the rest.
import { Image } from "expo-image";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { createLogger } from "./logger";
import { PUSH_PREF_KEY } from "./push";
import { pinsStorageKey } from "./stores/chat-pins-store";

const log = createLogger("local-wipe");

export async function wipeDeviceTraces(workspaceIds: readonly string[]): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["image_disk_cache", () => Image.clearDiskCache()],
    ["image_memory_cache", () => Image.clearMemoryCache()],
    ["notifications", () => Notifications.dismissAllNotificationsAsync()],
    ["badge", () => Notifications.setBadgeCountAsync(0)],
    ["push_preference", () => SecureStore.deleteItemAsync(PUSH_PREF_KEY)],
    ...workspaceIds.map((id): [string, () => Promise<unknown>] => ["pins", () => SecureStore.deleteItemAsync(pinsStorageKey(id))]),
  ];
  const results = await Promise.allSettled(steps.map(([, run]) => run()));
  results.forEach((result, index) => {
    if (result.status === "rejected") log.warn("wipe step failed", { step: steps[index]![0] });
  });
}
