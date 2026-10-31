import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_CHANNELS } from "@/lib/notification-channels";

const notifications = vi.hoisted(() => ({
  AndroidImportance: { HIGH: 6, DEFAULT: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 2 },
  setNotificationChannelAsync: vi.fn(async (_id: string, _channel: unknown) => null),
  deleteNotificationChannelAsync: vi.fn(async () => undefined),
}));
vi.mock("expo-notifications", () => notifications);

const { callChannelNames, ensureNotificationChannels } = await import("./notification-channels");

const t = (key: string) => `«${key}»`;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

describe("notification channels", () => {
  it("names the two call channels in the app's language", () => {
    expect(callChannelNames(t)).toEqual({
      calls: "«mobile.notify.channel_calls»",
      callsDescription: "«mobile.notify.channel_calls_hint»",
      ongoing: "«mobile.notify.channel_ongoing»",
      ongoingDescription: "«mobile.notify.channel_ongoing_hint»",
    });
  });

  it("creates every channel on Android, the calls natively, and drops the old chat channel", async () => {
    const native = { ensureChannels: vi.fn() };
    await ensureNotificationChannels(t, { platform: "android", native });
    expect(native.ensureChannels).toHaveBeenCalledWith(callChannelNames(t));
    expect(notifications.setNotificationChannelAsync.mock.calls.map(([id]) => id)).toEqual(["missed_calls", "mentions", "messages", "general", "chat_quiet"]);
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith("missed_calls", expect.objectContaining({ name: "«mobile.notify.channel_missed»", importance: 6, lockscreenVisibility: 1 }));
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith("messages", expect.objectContaining({ importance: 6, lockscreenVisibility: 2, enableVibrate: true }));
    expect(notifications.setNotificationChannelAsync.mock.calls.find(([id]) => id === "messages")?.[1]).not.toHaveProperty("sound");
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith("general", expect.objectContaining({ importance: 5 }));
    // A chat message that follows an alert of its room within the server's window replaces it without a sound. At
    // default importance, not low: a low one moves the conversation into Android's collapsed "Silent" section and
    // takes its status-bar icon away.
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      "chat_quiet",
      expect.objectContaining({ name: "«mobile.notify.channel_quiet»", importance: 5, lockscreenVisibility: 2, sound: null, enableVibrate: false }),
    );
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith("general", expect.objectContaining({ enableVibrate: true }));
    expect(notifications.setNotificationChannelAsync.mock.calls.find(([id]) => id === "general")?.[1]).not.toHaveProperty("sound");
    expect(notifications.deleteNotificationChannelAsync).toHaveBeenCalledWith("chat");
    expect(NOTIFICATION_CHANNELS).toHaveLength(5);
  });

  it("does nothing on iOS", async () => {
    const native = { ensureChannels: vi.fn() };
    await ensureNotificationChannels(t, { platform: "ios", native });
    expect(native.ensureChannels).not.toHaveBeenCalled();
    expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it("does not throw when Android refuses: the next launch tries again", async () => {
    notifications.setNotificationChannelAsync.mockRejectedValueOnce(new Error("no"));
    await expect(ensureNotificationChannels(t, { platform: "android", native: { ensureChannels: vi.fn() } })).resolves.toBeUndefined();
    notifications.setNotificationChannelAsync.mockRejectedValueOnce("no");
    await expect(ensureNotificationChannels(t, { platform: "android", native: { ensureChannels: vi.fn() } })).resolves.toBeUndefined();
  });
});
