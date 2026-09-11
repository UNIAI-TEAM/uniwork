import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarTypingStore } from "./sidebar-typing-store";

describe("useSidebarTypingStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSidebarTypingStore.getState().clearAll();
  });

  afterEach(() => {
    useSidebarTypingStore.getState().clearAll();
    vi.useRealTimers();
  });

  it("tracks typing users per room excluding self", () => {
    const { bump } = useSidebarTypingStore.getState();
    bump("room1", "USER_B", "USER_A");
    bump("room1", "USER_A", "USER_A");
    expect(useSidebarTypingStore.getState().byRoomId.room1).toEqual(["USER_B"]);
  });

  it("expires typing users after TTL", () => {
    const { bump } = useSidebarTypingStore.getState();
    bump("room1", "USER_B", "USER_A");
    vi.advanceTimersByTime(3_000);
    expect(useSidebarTypingStore.getState().byRoomId.room1).toBeUndefined();
  });
});
