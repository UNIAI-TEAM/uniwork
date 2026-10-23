// The Android notification channels, one per kind of push (server
// notification/push_expo.go › pushChannel names the same ids), so a person can
// keep calls and mentions loud and quiet the rest in the phone's settings.
// The two call channels belong to modules/unichat-calls (the ringtone with the
// ringtone's audio attributes, which expo-notifications cannot set); the rest
// are created through expo-notifications. Names are in the app's language and
// follow it. A channel's sound and importance are fixed once created on a
// phone: changing either needs a new id, and the old one goes in LEGACY.

type ChannelImportance = "high" | "default" | "low";

export interface ChannelSpec {
  id: string;
  nameKey: string;
  descriptionKey: string;
  importance: ChannelImportance;
  /** Whether the lock screen shows the text, or only that something came. */
  lockscreen: "public" | "private";
}

export const NOTIFICATION_CHANNELS: readonly ChannelSpec[] = [
  {
    id: "missed_calls",
    nameKey: "mobile.notify.channel_missed",
    descriptionKey: "mobile.notify.channel_missed_hint",
    importance: "high",
    lockscreen: "public",
  },
  {
    id: "mentions",
    nameKey: "mobile.notify.channel_mentions",
    descriptionKey: "mobile.notify.channel_mentions_hint",
    importance: "high",
    lockscreen: "private",
  },
  {
    id: "messages",
    nameKey: "mobile.notify.channel_messages",
    descriptionKey: "mobile.notify.channel_messages_hint",
    importance: "high",
    lockscreen: "private",
  },
  {
    id: "general",
    nameKey: "mobile.notify.channel_general",
    descriptionKey: "mobile.notify.channel_general_hint",
    importance: "default",
    lockscreen: "private",
  },
  // Low importance makes no sound and no vibration: a chat message that follows one its room alerted for within
  // the server's window (push_consumer.go › chatAlertWindow) replaces the room's notification on it quietly. The
  // server sends it only to a build that says it has it (data/push.ts › chat_quiet).
  {
    id: "chat_quiet",
    nameKey: "mobile.notify.channel_quiet",
    descriptionKey: "mobile.notify.channel_quiet_hint",
    importance: "low",
    lockscreen: "private",
  },
];

/** modules/unichat-calls › ensureChannels: the ringing call and the call under way. */
export const CALL_CHANNEL_KEYS = {
  calls: "mobile.notify.channel_calls",
  callsDescription: "mobile.notify.channel_calls_hint",
  ongoing: "mobile.notify.channel_ongoing",
  ongoingDescription: "mobile.notify.channel_ongoing_hint",
} as const;

/** Channels an older build created; dropped so the settings list only shows live ones. */
export const LEGACY_CHANNELS: readonly string[] = ["chat"];
