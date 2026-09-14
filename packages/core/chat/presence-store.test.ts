import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_PRESENCE_TTL_MS, usePresenceStore } from "./presence-store";

describe("usePresenceStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePresenceStore.getState().clearAll();
  });

  afterEach(() => {
    usePresenceStore.getState().clearAll();
    vi.useRealTimers();
  });

  it("marks a peer online and ignores self", () => {
    const { bump } = usePresenceStore.getState();
    bump("USER_B", "USER_A");
    bump("USER_A", "USER_A");
    expect(usePresenceStore.getState().onlineUserIds).toEqual({ USER_B: true });
  });

  it("drops a peer after TTL via prune", () => {
    const { bump, prune } = usePresenceStore.getState();
    bump("USER_B", "USER_A");
    vi.advanceTimersByTime(CHAT_PRESENCE_TTL_MS);
    prune(Date.now());
    expect(usePresenceStore.getState().onlineUserIds).toEqual({});
  });

  it("markOffline clears immediately", () => {
    const { bump, markOffline } = usePresenceStore.getState();
    bump("USER_B", "USER_A");
    markOffline("USER_B");
    expect(usePresenceStore.getState().onlineUserIds).toEqual({});
  });

  it("refreshed bumps keep the peer online past the first TTL window", () => {
    const { bump, prune } = usePresenceStore.getState();
    bump("USER_B", "USER_A");
    vi.advanceTimersByTime(CHAT_PRESENCE_TTL_MS - 1_000);
    bump("USER_B", "USER_A");
    vi.advanceTimersByTime(CHAT_PRESENCE_TTL_MS - 1_000);
    prune(Date.now());
    expect(usePresenceStore.getState().onlineUserIds).toEqual({ USER_B: true });
  });
});
