// Creates the Android notification channels (lib/notification-channels.ts) in
// the app's language: at launch and on every change of language (names may
// change, sound and importance may not), and before a ringing notification in
// a headless task. Android only; elsewhere nothing to do.
import * as Notifications from "expo-notifications";
import { CALL_CHANNEL_KEYS, LEGACY_CHANNELS, NOTIFICATION_CHANNELS } from "@/lib/notification-channels";
import { createLogger } from "./logger";
import type { CallChannelNames, NativeCalls } from "./calls/native-calls";

type Translate = (key: string) => string;

const log = createLogger("push");

export function callChannelNames(t: Translate): CallChannelNames {
  return {
    calls: t(CALL_CHANNEL_KEYS.calls),
    callsDescription: t(CALL_CHANNEL_KEYS.callsDescription),
    ongoing: t(CALL_CHANNEL_KEYS.ongoing),
    ongoingDescription: t(CALL_CHANNEL_KEYS.ongoingDescription),
  };
}

export async function ensureNotificationChannels(t: Translate, env: { platform: string; native: Pick<NativeCalls, "ensureChannels"> }): Promise<void> {
  if (env.platform !== "android") return;
  try {
    env.native.ensureChannels(callChannelNames(t));
    for (const channel of NOTIFICATION_CHANNELS) {
      await Notifications.setNotificationChannelAsync(channel.id, {
        name: t(channel.nameKey),
        description: t(channel.descriptionKey),
        importance: channel.importance === "high" ? Notifications.AndroidImportance.HIGH : Notifications.AndroidImportance.DEFAULT,
        lockscreenVisibility: channel.lockscreen === "public" ? Notifications.AndroidNotificationVisibility.PUBLIC : Notifications.AndroidNotificationVisibility.PRIVATE,
        sound: "default",
        enableVibrate: true,
        showBadge: true,
      });
    }
    for (const id of LEGACY_CHANNELS) await Notifications.deleteNotificationChannelAsync(id);
  } catch (error) {
    // A push still shows on Android's fallback channel; the next launch tries again.
    log.warn("notification channels not created", { error: error instanceof Error ? error.name : typeof error });
  }
}
