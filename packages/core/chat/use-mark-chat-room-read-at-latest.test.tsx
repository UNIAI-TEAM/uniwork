import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/endpoints/chat";
import { CHAT_READ_DEBOUNCE_MS, useMarkChatRoomReadAtLatest } from "./use-mark-chat-room-read-at-latest";

type Props = { roomId: string; newest: string | null; atLatest: boolean };

function setup(initial: Props) {
  const qc = new QueryClient();
  return renderHook(({ roomId, newest, atLatest }: Props) => useMarkChatRoomReadAtLatest("ws1", roomId, newest, atLatest), {
    initialProps: initial,
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

// H6: the read pointer moved only on entering or leaving a room, so a room
// being read kept counting unread and "seen" in a DM lagged.
describe("useMarkChatRoomReadAtLatest", () => {
  let mark: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
    mark = vi.spyOn(chatApi, "markChatRoomRead").mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("marks a new message read once the reader has been at the latest for the debounce", async () => {
    const { rerender } = setup({ roomId: "r1", newest: "m1", atLatest: true });
    // The first message seen in a room was marked on entering it.
    await act(async () => vi.advanceTimersByTimeAsync(CHAT_READ_DEBOUNCE_MS));
    expect(mark).not.toHaveBeenCalled();

    rerender({ roomId: "r1", newest: "m2", atLatest: true });
    await act(async () => vi.advanceTimersByTimeAsync(CHAT_READ_DEBOUNCE_MS - 1));
    expect(mark).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mark).toHaveBeenCalledWith("ws1", "r1");
  });

  it("waits while the reader is scrolled up or the tab is hidden", async () => {
    const { rerender } = setup({ roomId: "r1", newest: "m1", atLatest: true });
    rerender({ roomId: "r1", newest: "m2", atLatest: false });
    await act(async () => vi.advanceTimersByTimeAsync(CHAT_READ_DEBOUNCE_MS * 2));
    expect(mark).not.toHaveBeenCalled();

    act(() => setVisibility("hidden"));
    rerender({ roomId: "r1", newest: "m2", atLatest: true });
    await act(async () => vi.advanceTimersByTimeAsync(CHAT_READ_DEBOUNCE_MS * 2));
    expect(mark).not.toHaveBeenCalled();

    act(() => setVisibility("visible"));
    await act(async () => vi.advanceTimersByTimeAsync(CHAT_READ_DEBOUNCE_MS));
    expect(mark).toHaveBeenCalledTimes(1);
  });
});
