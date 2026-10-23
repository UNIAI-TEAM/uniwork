import { beforeEach, describe, expect, it, vi } from "vitest";

const image = vi.hoisted(() => ({ clearDiskCache: vi.fn(async () => true), clearMemoryCache: vi.fn(async () => true) }));
vi.mock("expo-image", () => ({ Image: image }));
const notifications = vi.hoisted(() => ({ dismissAllNotificationsAsync: vi.fn(async () => undefined), setBadgeCountAsync: vi.fn(async () => true) }));
vi.mock("expo-notifications", () => notifications);
const secureStore = vi.hoisted(() => ({ deleteItemAsync: vi.fn(async (_key: string) => undefined), getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock("expo-secure-store", () => secureStore);
const warn = vi.hoisted(() => vi.fn());
vi.mock("./logger", () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }) }));

import { wipeDeviceTraces, wipeSessionTraces } from "./local-wipe";

beforeEach(() => vi.clearAllMocks());

describe("wipeSessionTraces", () => {
  // Every sign-out and every session the server ends (revoked device, reused refresh token): the photos of the
  // account's conversations and the banners of its messages do not outlive the session on a lost phone.
  it("drops the image caches, the tray and the badge, and leaves the device's push choice and the pins", async () => {
    await wipeSessionTraces();
    expect(image.clearDiskCache).toHaveBeenCalledTimes(1);
    expect(image.clearMemoryCache).toHaveBeenCalledTimes(1);
    expect(notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it("a step that fails is logged by name and keeps the others", async () => {
    notifications.dismissAllNotificationsAsync.mockRejectedValueOnce(new Error("io"));
    await expect(wipeSessionTraces()).resolves.toBeUndefined();
    expect(notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
    expect(warn.mock.calls).toEqual([["wipe step failed", { step: "notifications" }]]);
  });
});

describe("wipeDeviceTraces", () => {
  it("drops the image caches, the tray, the badge, the push choice and each workspace's pins", async () => {
    await wipeDeviceTraces(["w1", "w2"]);
    expect(image.clearDiskCache).toHaveBeenCalledTimes(1);
    expect(image.clearMemoryCache).toHaveBeenCalledTimes(1);
    expect(notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
    expect(secureStore.deleteItemAsync.mock.calls.map(([key]) => key)).toEqual(["push_enabled", "uniwork_chat_pins_w1", "uniwork_chat_pins_w2"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a step that fails is logged by name and keeps the others", async () => {
    image.clearDiskCache.mockRejectedValueOnce(new Error("io"));
    notifications.setBadgeCountAsync.mockRejectedValueOnce(new Error("no permission"));
    await expect(wipeDeviceTraces([])).resolves.toBeUndefined();
    expect(notifications.dismissAllNotificationsAsync).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls).toEqual([
      ["wipe step failed", { step: "image_disk_cache" }],
      ["wipe step failed", { step: "badge" }],
    ]);
  });
});
