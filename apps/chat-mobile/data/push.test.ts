import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: vi.fn(async () => null),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[abc]" })),
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));
vi.mock("expo-notifications", () => notifications);

// the push preference's one SecureStore key, in memory
const store = vi.hoisted(() => ({ values: new Map<string, string>(), failRead: false }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => {
    if (store.failRead) throw new Error("keychain locked");
    return store.values.get(key) ?? null;
  }),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.values.set(key, value);
  }),
}));

const api = {
  subscribePush: vi.fn<(body: unknown) => Promise<void>>(async () => undefined),
  unsubscribePush: vi.fn<(body: { endpoint: string }) => Promise<void>>(async () => undefined),
};

async function load() {
  vi.resetModules();
  return import("./push");
}

beforeEach(() => {
  vi.clearAllMocks();
  store.values.clear();
  store.failRead = false;
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

describe("push preference", () => {
  const options = { api, projectId: "p1", platform: "ios" };

  it("is on until turned off, and an unreadable store reads as on", async () => {
    const { isPushEnabled } = await load();
    expect(await isPushEnabled()).toBe(true);
    store.values.set("push_enabled", "off");
    expect(await isPushEnabled()).toBe(false);
    store.failRead = true;
    expect(await isPushEnabled()).toBe(true);
  });

  it("turned off, a launch registers nothing and asks nothing", async () => {
    store.values.set("push_enabled", "off");
    const { registerPushToken } = await load();
    expect(await registerPushToken(options)).toBeNull();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(api.subscribePush).not.toHaveBeenCalled();
  });

  it("off drops the registered subscription on the server before it remembers the choice", async () => {
    const { registerPushToken, setPushEnabled } = await load();
    await registerPushToken(options);
    let storedDuringCall: string | undefined = "unset";
    api.unsubscribePush.mockImplementationOnce(async () => {
      storedDuringCall = store.values.get("push_enabled");
    });
    expect(await setPushEnabled(false, options)).toBeNull();
    expect(api.unsubscribePush).toHaveBeenCalledWith({ endpoint: "ExponentPushToken[abc]" });
    expect(storedDuringCall).toBeUndefined();
    expect(store.values.get("push_enabled")).toBe("off");
  });

  it("off asks Expo for the token when this process never registered one", async () => {
    const { setPushEnabled } = await load();
    await setPushEnabled(false, options);
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "p1" });
    expect(api.unsubscribePush).toHaveBeenCalledWith({ endpoint: "ExponentPushToken[abc]" });
  });

  it("off with no token to name (no permission, no EAS) only remembers the choice", async () => {
    notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const { setPushEnabled } = await load();
    await setPushEnabled(false, options);
    await setPushEnabled(false, { ...options, projectId: undefined });
    expect(api.unsubscribePush).not.toHaveBeenCalled();
    expect(store.values.get("push_enabled")).toBe("off");
  });

  it("a failed unsubscribe rejects and leaves push on", async () => {
    api.unsubscribePush.mockRejectedValueOnce(new Error("offline"));
    const { registerPushToken, setPushEnabled } = await load();
    await registerPushToken(options);
    await expect(setPushEnabled(false, options)).rejects.toThrow("offline");
    expect(store.values.get("push_enabled")).toBeUndefined();
  });

  it("on remembers the choice and registers again", async () => {
    store.values.set("push_enabled", "off");
    const { setPushEnabled } = await load();
    expect(await setPushEnabled(true, options)).toBe("ExponentPushToken[abc]");
    expect(store.values.get("push_enabled")).toBe("on");
    expect(api.subscribePush).toHaveBeenCalledTimes(1);
  });
});
