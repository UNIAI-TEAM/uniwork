import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { useChatRoomScopes } from "./use-chat-room-scopes";

const listeners = new Set<(msg: WSMessage) => void>();
const subscribe = vi.fn();
const unsubscribe = vi.fn();
const client = {
  subscribe,
  unsubscribe,
  onAny: (handler: (msg: WSMessage) => void) => {
    listeners.add(handler);
    return () => listeners.delete(handler);
  },
} as unknown as WSClient;

function emit(type: string, payload: Record<string, string>) {
  for (const handler of [...listeners]) handler({ type, payload } as unknown as WSMessage);
}

vi.mock("./provider", () => ({
  useOptionalWS: () => ({ client }),
}));

describe("useChatRoomScopes", () => {
  beforeEach(() => {
    subscribe.mockClear();
    unsubscribe.mockClear();
  });

  it("diffs subscriptions when the room set changes", () => {
    const { rerender, unmount } = renderHook(({ ids }) => useChatRoomScopes(ids), {
      initialProps: { ids: ["a", "b"] },
    });

    expect(subscribe).toHaveBeenCalledWith("chat", "a");
    expect(subscribe).toHaveBeenCalledWith("chat", "b");

    subscribe.mockClear();
    unsubscribe.mockClear();
    rerender({ ids: ["b", "c"] });

    expect(unsubscribe).toHaveBeenCalledWith("chat", "a");
    expect(subscribe).toHaveBeenCalledWith("chat", "c");
    expect(subscribe).not.toHaveBeenCalledWith("chat", "b");

    unmount();
    expect(unsubscribe).toHaveBeenCalledWith("chat", "b");
    expect(unsubscribe).toHaveBeenCalledWith("chat", "c");
  });

  // H5: a subscribe the server could not check (`lookup_failed`, DB slow)
  // left the room deaf until the next reconnect.
  describe("when the server could not decide", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("asks again after a failed lookup, until the server answers", () => {
      const { unmount } = renderHook(() => useChatRoomScopes(["a"]));
      subscribe.mockClear();

      emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
      emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
      vi.advanceTimersByTime(30_000);
      expect(subscribe).toHaveBeenCalledExactlyOnceWith("chat", "a");

      emit("subscribe_ack", { scope: "chat", id: "a" });
      vi.advanceTimersByTime(60_000);
      expect(subscribe).toHaveBeenCalledTimes(1);
      unmount();
    });

    it("takes a refusal, another scope's failure or a dropped room as final", () => {
      const { rerender, unmount } = renderHook(({ ids }) => useChatRoomScopes(ids), {
        initialProps: { ids: ["a", "b"] },
      });
      subscribe.mockClear();

      emit("subscribe_error", { scope: "chat", id: "a", error: "forbidden" });
      emit("subscribe_error", { scope: "meeting", id: "b", error: "lookup_failed" });
      emit("subscribe_error", { scope: "chat", id: "b", error: "lookup_failed" });
      rerender({ ids: ["a"] });
      vi.advanceTimersByTime(60_000);
      expect(subscribe).not.toHaveBeenCalled();
      unmount();
    });

    it("gives up after the backoff table runs out", () => {
      const { unmount } = renderHook(() => useChatRoomScopes(["a"]));
      subscribe.mockClear();
      for (let i = 0; i < 10; i += 1) {
        emit("subscribe_error", { scope: "chat", id: "a", error: "lookup_failed" });
        vi.advanceTimersByTime(60_000);
      }
      expect(subscribe).toHaveBeenCalledTimes(4);
      unmount();
    });
  });
});
