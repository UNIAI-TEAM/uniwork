import { beforeEach, describe, expect, it } from "vitest";
import {
  comparePinnedRoomOrder,
  resetChatRoomPreferencesForTests,
  useChatRoomPreferencesStore,
} from "./room-preferences-store";

beforeEach(() => {
  resetChatRoomPreferencesForTests();
});

describe("useChatRoomPreferencesStore", () => {
  it("toggles mute and pin independently", () => {
    const store = useChatRoomPreferencesStore.getState();
    expect(store.isNotificationsMuted("room-a")).toBe(false);
    expect(store.isPinned("room-a")).toBe(false);

    store.toggleNotificationsMuted("room-a");
    expect(useChatRoomPreferencesStore.getState().isNotificationsMuted("room-a")).toBe(true);

    store.togglePinned("room-a");
    const afterPin = useChatRoomPreferencesStore.getState();
    expect(afterPin.isPinned("room-a")).toBe(true);
    expect(afterPin.pinnedAt("room-a")).toBeGreaterThan(0);
    expect(afterPin.isNotificationsMuted("room-a")).toBe(true);
  });
});

describe("comparePinnedRoomOrder", () => {
  it("sorts pinned rooms before unpinned", () => {
    const byRoomId = {
      pinned: { notificationsMuted: false, pinned: true, pinnedAt: 20 },
      normal: { notificationsMuted: false, pinned: false, pinnedAt: 0 },
    };
    expect(comparePinnedRoomOrder("pinned", "normal", byRoomId)).toBeLessThan(0);
    expect(comparePinnedRoomOrder("normal", "pinned", byRoomId)).toBeGreaterThan(0);
  });
});
