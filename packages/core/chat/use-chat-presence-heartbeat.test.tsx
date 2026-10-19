import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "../auth";
import type { User } from "../types/user";
import { usePresenceStore } from "./presence-store";
import { useHostFocus } from "../platform/host-focus";
import { useChatPresenceHeartbeat } from "./use-chat-presence-heartbeat";

const beatChatPresence = vi.fn<(workspaceId: string, visible: boolean) => Promise<string[] | null>>();
const signalChatPresence = vi.fn<
  (workspaceId: string, state: "online" | "offline", opts?: { keepalive?: boolean }) => Promise<boolean>
>();

vi.mock("../api/endpoints/chat-presence", () => ({
  beatChatPresence: (workspaceId: string, visible: boolean) => beatChatPresence(workspaceId, visible),
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
    expect(beatChatPresence).toHaveBeenCalledWith("ws1", true);
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

  it("marks a beat from a hidden tab as not visible", () => {
    beatChatPresence.mockResolvedValue([]);
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useChatPresenceHeartbeat("ws1"));
    expect(beatChatPresence).toHaveBeenCalledWith("ws1", false);
    state.mockRestore();
  });

  it("marks a beat from an unfocused UniChat window as not visible", async () => {
    beatChatPresence.mockResolvedValue([]);
    // Electron keeps visibilityState "visible" behind other windows; the bridge's focus is the truth.
    (window as Window & { desktopAPI?: unknown }).desktopAPI = {
      app: "unichat",
      isFocused: async () => false,
      onFocusChange: () => () => {},
    };
    try {
      const focus = renderHook(() => useHostFocus());
      await act(async () => {});
      expect(focus.result.current).toBe(false);
      renderHook(() => useChatPresenceHeartbeat("ws1"));
      expect(document.visibilityState).toBe("visible");
      expect(beatChatPresence).toHaveBeenCalledWith("ws1", false);
    } finally {
      delete (window as Window & { desktopAPI?: unknown }).desktopAPI;
    }
  });

  it("does nothing when disabled or without a workspace", () => {
    renderHook(() => useChatPresenceHeartbeat("ws1", false));
    renderHook(() => useChatPresenceHeartbeat(""));
    expect(beatChatPresence).not.toHaveBeenCalled();
  });
});
