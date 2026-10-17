// Parity: packages/core/chat/sidebar-typing-store.test.ts verbatim.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarTypingStore } from "./chat-typing-store";

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

  // Mobile additions: the edges the core suite leaves out.
  it("ignores blank ids, keeps one entry per typist and restarts their clock on each frame", () => {
    const { bump } = useSidebarTypingStore.getState();
    bump(" ", "USER_B", "USER_A");
    bump("room1", " ", "USER_A");
    expect(useSidebarTypingStore.getState().byRoomId).toEqual({});
    bump("room1", "USER_B", "USER_A");
    vi.advanceTimersByTime(2_000);
    bump("room1", "user_b", "USER_A");
    bump("room1", "USER_C", "USER_A");
    vi.advanceTimersByTime(2_000);
    expect(useSidebarTypingStore.getState().byRoomId.room1).toEqual(["USER_B", "USER_C"]);
    vi.advanceTimersByTime(1_000);
    expect(useSidebarTypingStore.getState().byRoomId).toEqual({});
  });

  it("drops one typist and keeps the others, and a timer after clearAll changes nothing", () => {
    const { bump } = useSidebarTypingStore.getState();
    bump("room1", "USER_B", "USER_A");
    vi.advanceTimersByTime(1_000);
    bump("room1", "USER_C", "USER_A");
    vi.advanceTimersByTime(2_000);
    expect(useSidebarTypingStore.getState().byRoomId.room1).toEqual(["USER_C"]);
    useSidebarTypingStore.setState({ byRoomId: {} });
    const before = useSidebarTypingStore.getState();
    vi.advanceTimersByTime(1_000);
    expect(useSidebarTypingStore.getState()).toBe(before);
  });
});
