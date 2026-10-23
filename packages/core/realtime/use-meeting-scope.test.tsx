import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { useMeetingScope } from "./use-meeting-scope";

function fakeClient() {
  const listeners = new Set<(msg: WSMessage) => void>();
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onAny: vi.fn((handler: (msg: WSMessage) => void) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }),
    emit(type: string, payload: Record<string, string>) {
      for (const handler of [...listeners]) handler({ type, payload } as unknown as WSMessage);
    },
    listenerCount: () => listeners.size,
  };
}

let current: ReturnType<typeof fakeClient> | null = null;

vi.mock("./provider", () => ({
  useOptionalWS: () => (current ? { client: current as unknown as WSClient } : null),
}));

describe("useMeetingScope", () => {
  beforeEach(() => {
    current = fakeClient();
  });

  it("subscribes while mounted and unsubscribes on unmount", () => {
    const client = current!;
    const { unmount } = renderHook(() => useMeetingScope("m1"));
    expect(client.subscribe).toHaveBeenCalledExactlyOnceWith("meeting", "m1");

    unmount();
    expect(client.unsubscribe).toHaveBeenCalledExactlyOnceWith("meeting", "m1");
  });

  it("moves the subscription when the meeting changes", () => {
    const client = current!;
    const { rerender, unmount } = renderHook(({ id }) => useMeetingScope(id), {
      initialProps: { id: "m1" },
    });
    rerender({ id: "m2" });
    expect(client.unsubscribe).toHaveBeenCalledWith("meeting", "m1");
    expect(client.subscribe).toHaveBeenLastCalledWith("meeting", "m2");
    unmount();
    expect(client.unsubscribe).toHaveBeenLastCalledWith("meeting", "m2");
  });

  it("keeps the meeting while another screen still holds it", () => {
    const client = current!;
    const room = renderHook(() => useMeetingScope("m1"));
    const detail = renderHook(() => useMeetingScope("m1"));
    expect(client.subscribe).toHaveBeenCalledTimes(1);

    room.unmount();
    expect(client.unsubscribe).not.toHaveBeenCalled();

    detail.unmount();
    expect(client.unsubscribe).toHaveBeenCalledExactlyOnceWith("meeting", "m1");
  });

  it("subscribes the new socket when the socket is replaced", () => {
    const first = current!;
    const { rerender, unmount } = renderHook(() => useMeetingScope("m1"));
    const second = fakeClient();
    current = second;
    rerender();
    expect(first.unsubscribe).toHaveBeenCalledWith("meeting", "m1");
    expect(second.subscribe).toHaveBeenCalledExactlyOnceWith("meeting", "m1");
    unmount();
    expect(second.unsubscribe).toHaveBeenCalledExactlyOnceWith("meeting", "m1");
  });

  it("holds nothing without a meeting id or a socket", () => {
    const client = current!;
    renderHook(() => useMeetingScope(""));
    expect(client.subscribe).not.toHaveBeenCalled();

    current = null;
    const { unmount } = renderHook(() => useMeetingScope("m1"));
    unmount();
    expect(client.subscribe).not.toHaveBeenCalled();
  });

  describe("when the server could not decide", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("asks again after a failed lookup, until the server answers", () => {
      const client = current!;
      renderHook(() => useMeetingScope("m1"));
      expect(client.subscribe).toHaveBeenCalledTimes(1);

      client.emit("subscribe_error", { scope: "meeting", id: "m1", error: "lookup_failed" });
      // A burst of failures for the same meeting schedules one retry.
      client.emit("subscribe_error", { scope: "meeting", id: "m1", error: "lookup_failed" });
      vi.advanceTimersByTime(30_000);
      expect(client.subscribe).toHaveBeenCalledTimes(2);
      expect(client.subscribe).toHaveBeenLastCalledWith("meeting", "m1");

      client.emit("subscribe_ack", { scope: "meeting", id: "m1" });
      vi.advanceTimersByTime(60_000);
      expect(client.subscribe).toHaveBeenCalledTimes(2);
    });

    it("takes a refusal, or another meeting's failure, as final", () => {
      const client = current!;
      renderHook(() => useMeetingScope("m1"));
      client.emit("subscribe_error", { scope: "meeting", id: "m1", error: "forbidden" });
      client.emit("subscribe_error", { scope: "meeting", id: "m2", error: "lookup_failed" });
      client.emit("subscribe_error", { scope: "chat", id: "m1", error: "lookup_failed" });
      vi.advanceTimersByTime(60_000);
      expect(client.subscribe).toHaveBeenCalledTimes(1);
    });

    it("drops a pending retry and its listener once the last screen lets go", () => {
      const client = current!;
      const { unmount } = renderHook(() => useMeetingScope("m1"));
      client.emit("subscribe_error", { scope: "meeting", id: "m1", error: "lookup_failed" });
      unmount();
      vi.advanceTimersByTime(60_000);
      expect(client.subscribe).toHaveBeenCalledTimes(1);
      expect(client.listenerCount()).toBe(0);
    });
  });
});
