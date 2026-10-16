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
  it("toggles a pin and stamps when it was pinned", () => {
    const store = useChatRoomPreferencesStore.getState();
    expect(store.isPinned("room-a")).toBe(false);

    store.togglePinned("room-a");
    const afterPin = useChatRoomPreferencesStore.getState();
    expect(afterPin.isPinned("room-a")).toBe(true);
    expect(afterPin.pinnedAt("room-a")).toBeGreaterThan(0);
  });
});

describe("comparePinnedRoomOrder", () => {
  it("sorts pinned rooms before unpinned", () => {
    const byRoomId = {
      pinned: { pinned: true, pinnedAt: 20 },
      normal: { pinned: false, pinnedAt: 0 },
    };
    expect(comparePinnedRoomOrder("pinned", "normal", byRoomId)).toBeLessThan(0);
    expect(comparePinnedRoomOrder("normal", "pinned", byRoomId)).toBeGreaterThan(0);
  });
});
