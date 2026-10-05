import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "../auth";
import type { User } from "../types/user";
import { usePresenceStore } from "./presence-store";
import { useChatPresenceHeartbeat } from "./use-chat-presence-heartbeat";

const beatChatPresence = vi.fn<(workspaceId: string) => Promise<string[] | null>>();
const signalChatPresence = vi.fn<
  (workspaceId: string, state: "online" | "offline", opts?: { keepalive?: boolean }) => Promise<boolean>
>();

vi.mock("../api/endpoints/chat-presence", () => ({
  beatChatPresence: (workspaceId: string) => beatChatPresence(workspaceId),
}));
vi.mock("../api/endpoints/chat", () => ({
  signalChatPresence: (
    workspaceId: string,
    state: "online" | "offline",
    opts?: { keepalive?: boolean },
  ) => signalChatPresence(workspaceId, state, opts),
}));

const me: User = {
  id: "USER_A",
  email: "a@example.com",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const online = () => usePresenceStore.getState().onlineUserIds;

describe("useChatPresenceHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSessionUser(me);
    usePresenceStore.getState().clearAll();
    beatChatPresence.mockReset();
    signalChatPresence.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    usePresenceStore.getState().clearAll();
    resetAuthStoreForTests();
    vi.useRealTimers();
  });

  it("beats on mount and every 15s, and takes each snapshot minus self", async () => {
    beatChatPresence
      .mockResolvedValueOnce(["USER_A", "USER_B"])
      .mockResolvedValueOnce(["USER_A", "USER_C"]);
    renderHook(() => useChatPresenceHeartbeat("ws1"));
    await act(async () => {});
    expect(beatChatPresence).toHaveBeenCalledWith("ws1");
    expect(online()).toEqual({ USER_B: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(beatChatPresence).toHaveBeenCalledTimes(2);
    expect(online()).toEqual({ USER_C: true });
  });

  it("leaves the set to bumps and expiry when the server sends no snapshot", async () => {
    beatChatPresence.mockResolvedValue(null);
    usePresenceStore.getState().bump("USER_B", "USER_A");
    renderHook(() => useChatPresenceHeartbeat("ws1"));
    await act(async () => {});
    expect(online()).toEqual({ USER_B: true });
  });

  it("swallows a failed beat", async () => {
    beatChatPresence.mockRejectedValue(new Error("offline"));
    usePresenceStore.getState().bump("USER_B", "USER_A");
    renderHook(() => useChatPresenceHeartbeat("ws1"));
    await act(async () => {});
    expect(online()).toEqual({ USER_B: true });
  });

  it("says offline on unmount and ignores a snapshot that lands afterwards", async () => {
    let resolve: (ids: string[]) => void = () => undefined;
    beatChatPresence.mockReturnValue(
      new Promise<string[]>((r) => {
        resolve = r;
      }),
    );
    const { unmount } = renderHook(() => useChatPresenceHeartbeat("ws1"));
    unmount();
    expect(signalChatPresence).toHaveBeenCalledWith("ws1", "offline", undefined);
    await act(async () => {
      resolve(["USER_B"]);
    });
    expect(online()).toEqual({});
  });

  it("says offline with keepalive when the page goes away", () => {
    beatChatPresence.mockResolvedValue([]);
    renderHook(() => useChatPresenceHeartbeat("ws1"));
    window.dispatchEvent(new Event("pagehide"));
    expect(signalChatPresence).toHaveBeenCalledWith("ws1", "offline", { keepalive: true });
  });

  it("does nothing when disabled or without a workspace", () => {
    renderHook(() => useChatPresenceHeartbeat("ws1", false));
    renderHook(() => useChatPresenceHeartbeat(""));
    expect(beatChatPresence).not.toHaveBeenCalled();
  });
});
