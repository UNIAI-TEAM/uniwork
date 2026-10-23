import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: vi.fn(async () => null),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: "ExponentPushToken[abc]" })),
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  addPushTokenListener: vi.fn((listener: (token: { type: string; data: unknown }) => void) => {
    tokenListeners.add(listener);
    return { remove: () => tokenListeners.delete(listener) };
  }),
}));
const tokenListeners = vi.hoisted(() => new Set<(token: { type: string; data: unknown }) => void>());
/** FCM or APNs hands the app a device token (a fetch of the token emits it too). */
function emitDeviceToken(data: unknown) {
  for (const listener of [...tokenListeners]) listener({ type: "android", data });
}
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
  // data/logger.ts writes to the console in a development build only.
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
});
afterEach(() => {
  delete (globalThis as { __DEV__?: boolean }).__DEV__;
  vi.restoreAllMocks();
});

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

  it("tells the server an Android build draws its own incoming call, so call pushes come data-only", async () => {
    const { registerPushToken } = await load();
    await registerPushToken({ api, projectId: "p1", platform: "android", callUI: true });
    expect(api.subscribePush).toHaveBeenLastCalledWith({
      endpoint: "ExponentPushToken[abc]",
      keys: { p256dh: "", auth: "" },
      platform: "android",
      call_ui: true,
      chat_quiet: true,
    });
    // Without the native module (callUI false) the server keeps the visible call push; an iPhone never says it.
    await registerPushToken({ api, projectId: "p1", platform: "android", callUI: false });
    expect(api.subscribePush).toHaveBeenLastCalledWith({ endpoint: "ExponentPushToken[abc]", keys: { p256dh: "", auth: "" }, platform: "android", chat_quiet: true });
    await registerPushToken({ api, projectId: "p1", platform: "ios", callUI: true });
    expect(api.subscribePush).toHaveBeenLastCalledWith({ endpoint: "ExponentPushToken[abc]", keys: { p256dh: "", auth: "" }, platform: "ios" });
  });

  it("creates the Android channels before the permission prompt", async () => {
    const { registerPushToken } = await load();
    const channels = vi.fn(async () => undefined);
    await registerPushToken({ api, projectId: "p1", platform: "android", channels });
    expect(channels).toHaveBeenCalledTimes(1);
    expect(channels.mock.invocationCallOrder[0]).toBeLessThan(notifications.requestPermissionsAsync.mock.invocationCallOrder[0] ?? 0);
    // No channels to create on iOS, and none asked for: registration goes on.
    await registerPushToken({ api, projectId: "p1", platform: "ios", channels });
    expect(channels).toHaveBeenCalledTimes(1);
    expect(await registerPushToken({ api, projectId: "p1", platform: "android" })).toBe("ExponentPushToken[abc]");
  });

  it("asks through the primer when given one, which decides instead of the bare system prompt", async () => {
    const { registerPushToken } = await load();
    const ask = vi.fn(async () => true);
    expect(await registerPushToken({ api, projectId: "p1", platform: "ios", ask })).toBe("ExponentPushToken[abc]");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    ask.mockResolvedValueOnce(false);
    expect(await registerPushToken({ api, projectId: "p1", platform: "ios", ask })).toBeNull();
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

  it("forgets the token without a call after a sign-out the server made", async () => {
    const { forgetPushToken, registerPushToken, unregisterPushToken } = await load();
    await registerPushToken({ api, projectId: "p1", platform: "ios" });
    forgetPushToken();
    await unregisterPushToken(api);
    expect(api.unsubscribePush).not.toHaveBeenCalled();
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

describe("watchPushTokenRotation", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("registers again when FCM or APNs replaces the device token, and drops the old Expo token", async () => {
    const { registerPushToken, watchPushTokenRotation } = await load();
    const stop = watchPushTokenRotation({ api, projectId: "p1", platform: "android", callUI: true });
    await registerPushToken({ api, projectId: "p1", platform: "android", callUI: true });
    // Fetching the token at launch emits it: the first one seen is this registration's, not a rotation.
    emitDeviceToken("fcm-1");
    emitDeviceToken("fcm-1");
    await flush();
    expect(api.subscribePush).toHaveBeenCalledTimes(1);

    notifications.getExpoPushTokenAsync.mockResolvedValueOnce({ data: "ExponentPushToken[new]" });
    emitDeviceToken("fcm-2");
    await flush();
    expect(api.subscribePush).toHaveBeenCalledTimes(2);
    expect(api.subscribePush).toHaveBeenLastCalledWith({
      endpoint: "ExponentPushToken[new]",
      keys: { p256dh: "", auth: "" },
      platform: "android",
      call_ui: true,
      chat_quiet: true,
    });
    // Never a prompt: only a permission already granted counts.
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(api.unsubscribePush).toHaveBeenCalledWith({ endpoint: "ExponentPushToken[abc]" });

    stop();
    emitDeviceToken("fcm-3");
    await flush();
    expect(api.subscribePush).toHaveBeenCalledTimes(2);
  });

  it("keeps an unchanged Expo token's subscription and does nothing for a process that registered none", async () => {
    const { registerPushToken, watchPushTokenRotation } = await load();
    const stop = watchPushTokenRotation({ api, projectId: "p1", platform: "ios" });
    emitDeviceToken({ endpoint: "apns-1" });
    emitDeviceToken({ endpoint: "apns-2" });
    await flush();
    expect(api.subscribePush).not.toHaveBeenCalled();

    await registerPushToken({ api, projectId: "p1", platform: "ios" });
    emitDeviceToken("apns-3");
    await flush();
    expect(api.subscribePush).toHaveBeenCalledTimes(2);
    expect(api.unsubscribePush).not.toHaveBeenCalled();
    stop();
  });

  it("logs a failed registration and leaves the permission alone when it was taken back", async () => {
    const { registerPushToken, watchPushTokenRotation } = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stop = watchPushTokenRotation({ api, projectId: "p1", platform: "android" });
    await registerPushToken({ api, projectId: "p1", platform: "android" });
    emitDeviceToken("fcm-1");
    api.subscribePush.mockRejectedValueOnce(new Error("offline"));
    emitDeviceToken("fcm-2");
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    api.subscribePush.mockRejectedValueOnce("offline");
    emitDeviceToken("fcm-3");
    await flush();
    expect(warn).toHaveBeenCalledTimes(2);
    notifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false });
    emitDeviceToken("fcm-4");
    await flush();
    expect(api.subscribePush).toHaveBeenCalledTimes(3);
    stop();
  });
});
