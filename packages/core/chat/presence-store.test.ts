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

  it("reconcile replaces the set with the server's snapshot, minus self", () => {
    const { bump, reconcile } = usePresenceStore.getState();
    bump("USER_C", "USER_A");
    vi.advanceTimersByTime(1_000);
    reconcile(["user_a", "USER_B"], "USER_A", Date.now());
    expect(usePresenceStore.getState().onlineUserIds).toEqual({ USER_B: true });
  });

  it("a snapshot refreshes its peers so prune keeps them", () => {
    const { reconcile, prune } = usePresenceStore.getState();
    reconcile(["USER_B"], "USER_A", Date.now());
    vi.advanceTimersByTime(CHAT_PRESENCE_TTL_MS - 1_000);
    reconcile(["USER_B"], "USER_A", Date.now());
    vi.advanceTimersByTime(CHAT_PRESENCE_TTL_MS - 1_000);
    prune(Date.now());
    expect(usePresenceStore.getState().onlineUserIds).toEqual({ USER_B: true });
  });

  it("a backgrounded tab's minute-apart snapshots keep peers through its return", () => {
    // Chrome wakes a long-hidden tab's timers once a minute, so its beats and
    // their snapshots are ~60s apart; after it is shown again the next beat
    // can take another 15s. Peers the server still lists must not vanish.
    const { reconcile, prune } = usePresenceStore.getState();
    reconcile(["USER_B"], "USER_A", Date.now());
    vi.advanceTimersByTime(60_000 + 15_000);
    prune(Date.now());
    expect(usePresenceStore.getState().onlineUserIds).toEqual({ USER_B: true });
  });

  it("frames that arrive while the beat is in flight win over its snapshot", () => {
    const { bump, markOffline, reconcile } = usePresenceStore.getState();
    bump("USER_D", "USER_A");
    vi.advanceTimersByTime(1_000);
    const sentAt = Date.now();
    vi.advanceTimersByTime(100);
    bump("USER_B", "USER_A");
    markOffline("USER_D");
    // Computed before either frame: lacks B, still lists D.
    reconcile(["USER_D", "USER_E"], "USER_A", sentAt);
    expect(usePresenceStore.getState().onlineUserIds).toEqual({ USER_B: true, USER_E: true });
  });

  it("an unchanged snapshot keeps the same state object", () => {
    const { reconcile } = usePresenceStore.getState();
    reconcile(["USER_B"], "USER_A", Date.now());
    const before = usePresenceStore.getState().onlineUserIds;
    reconcile(["USER_B"], "USER_A", Date.now());
    expect(usePresenceStore.getState().onlineUserIds).toBe(before);
  });
});
