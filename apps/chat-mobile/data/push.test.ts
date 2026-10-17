import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: vi.fn(async () => null),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[abc]" })),
}));
vi.mock("expo-notifications", () => notifications);

const api = { subscribePush: vi.fn(async () => undefined), unsubscribePush: vi.fn(async () => undefined) };

async function load() {
  vi.resetModules();
  return import("./push");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("registerPushToken", () => {
  it("skips registration without an EAS projectId and logs once", async () => {
    const { registerPushToken } = await load();
    expect(await registerPushToken({ api, projectId: undefined, platform: "ios" })).toBeNull();
    expect(await registerPushToken({ api, projectId: "", platform: "ios" })).toBeNull();
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(api.subscribePush).not.toHaveBeenCalled();
  });

  it("asks permission, fetches the Expo token and subscribes with an empty web-push key pair", async () => {
    const { registerPushToken } = await load();
    expect(await registerPushToken({ api, projectId: "p1", platform: "ios" })).toBe("ExponentPushToken[abc]");
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "p1" });
    expect(api.subscribePush).toHaveBeenCalledWith({
      endpoint: "ExponentPushToken[abc]",
      keys: { p256dh: "", auth: "" },
      platform: "ios",
    });
    expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it("creates the high-importance chat channel on Android first", async () => {
    const { registerPushToken } = await load();
    await registerPushToken({ api, projectId: "p1", platform: "android" });
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith("chat", expect.objectContaining({ importance: 4 }));
    expect(notifications.setNotificationChannelAsync.mock.invocationCallOrder[0]).toBeLessThan(
      notifications.requestPermissionsAsync.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("stops at a denied permission", async () => {
    notifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const { registerPushToken } = await load();
    expect(await registerPushToken({ api, projectId: "p1", platform: "ios" })).toBeNull();
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(api.subscribePush).not.toHaveBeenCalled();
  });
});

describe("unregisterPushToken", () => {
  it("unsubscribes the registered token once and is a no-op without one", async () => {
    const { registerPushToken, unregisterPushToken } = await load();
    await unregisterPushToken(api);
    expect(api.unsubscribePush).not.toHaveBeenCalled();
    await registerPushToken({ api, projectId: "p1", platform: "ios" });
    await unregisterPushToken(api);
    await unregisterPushToken(api);
    expect(api.unsubscribePush).toHaveBeenCalledTimes(1);
    expect(api.unsubscribePush).toHaveBeenCalledWith({ endpoint: "ExponentPushToken[abc]" });
  });
});
