import { beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({ setBadgeCountAsync: vi.fn(async () => true) }));
vi.mock("expo-notifications", () => notifications);

async function load() {
  vi.resetModules();
  return import("./badge");
}

beforeEach(() => vi.clearAllMocks());

describe("setAppBadge", () => {
  it("sets the count once per change, never below zero", async () => {
    const { setAppBadge } = await load();
    await setAppBadge(3);
    await setAppBadge(3);
    await setAppBadge(-2);
    await setAppBadge(4.7);
    expect(notifications.setBadgeCountAsync.mock.calls).toEqual([[3], [0], [4]]);
  });

  it("tries again on the next call after a launcher refused", async () => {
    const { setAppBadge } = await load();
    notifications.setBadgeCountAsync.mockRejectedValueOnce(new Error("unsupported"));
    await setAppBadge(2);
    await setAppBadge(2);
    expect(notifications.setBadgeCountAsync).toHaveBeenCalledTimes(2);
  });
});
