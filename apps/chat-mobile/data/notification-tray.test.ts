import { beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({
  getPresentedNotificationsAsync: vi.fn<() => Promise<unknown[]>>(async () => []),
  dismissNotificationAsync: vi.fn<(id: string) => Promise<void>>(async () => undefined),
}));
vi.mock("expo-notifications", () => notifications);

const { dismissRoomNotifications } = await import("./notification-tray");

function presented(id: string, data: Record<string, unknown>) {
  return { request: { identifier: id, content: { data } } };
}

const msg = (room: string, extra: Record<string, unknown> = {}) => ({ workspace_id: "w1", room_id: room, message_id: `m-${room}`, ...extra });

beforeEach(() => vi.clearAllMocks());

describe("dismissRoomNotifications", () => {
  it("takes down the room's message notifications and leaves the rest of the tray", async () => {
    notifications.getPresentedNotificationsAsync.mockResolvedValueOnce([
      presented("a", msg("r1")),
      presented("b", msg("r1", { thread_root_id: "t1" })),
      presented("c", msg("r2")),
      presented("d", { type: "call_invite", call_id: "c1", room_id: "r1", workspace_id: "w1" }),
      presented("e", {}),
      { request: { identifier: "f", content: {} } },
    ]);
    expect(await dismissRoomNotifications("r1")).toBe(1);
    // A thread reply is read in its thread, a ringing call is not a message: both stay.
    expect(notifications.dismissNotificationAsync.mock.calls).toEqual([["a"]]);
  });

  it("is a no-op with nothing in the tray", async () => {
    expect(await dismissRoomNotifications("r1")).toBe(0);
    expect(notifications.dismissNotificationAsync).not.toHaveBeenCalled();
  });
});
