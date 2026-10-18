import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { useChatCatchUpUi } from "./use-chat-catch-up-ui";

initI18n();

const mocks = vi.hoisted(() => ({ catchUp: vi.fn(), markRead: vi.fn(), markThreadRead: vi.fn() }));

vi.mock("@uniwork/core/ai", () => ({
  useAiCapabilities: () => ({ data: { enabled: true, ask_uni: true } }),
  useChatCatchUp: () => ({ mutateAsync: mocks.catchUp, isPending: false }),
}));

vi.mock("@uniwork/core/chat", () => ({
  chatKeys: { rooms: (ws: string) => ["chat", "rooms", ws] },
  useMarkChatRoomRead: () => ({ mutateAsync: mocks.markRead }),
  useMarkChatThreadRead: () => ({ mutateAsync: mocks.markThreadRead }),
}));

const brief = { summary: "Tóm tắt", highlights: [], action_items: [], message_count: 3, since: "", mode: "unread" };

function setup() {
  return renderHook(() => useChatCatchUpUi("ws1", "room1"), { wrapper: ({ children }) => wrap(<>{children}</>) });
}

describe("useChatCatchUpUi", () => {
  beforeEach(() => {
    mocks.catchUp.mockReset();
    mocks.markRead.mockReset();
    mocks.markRead.mockResolvedValue(true);
    mocks.markThreadRead.mockReset();
    mocks.markThreadRead.mockResolvedValue(null);
  });

  it("marks the room read when the room opens", () => {
    setup();
    expect(mocks.markRead).toHaveBeenCalledWith("room1");
  });

  it("marks the room read on close once a brief was shown", async () => {
    mocks.catchUp.mockResolvedValue(brief);
    const { result } = setup();
    await act(async () => result.current.onCatchUp?.());
    expect(result.current.result).toEqual(brief);
    act(() => result.current.setOpen(false));
    expect(mocks.markRead).toHaveBeenCalledWith("room1");
  });

  // H6: opening the room marks it read, so the brief and the "Tin mới" line
  // start from the pointer the sidebar held before the room opened.
  it("keeps the pre-open read pointer and asks the brief to start there", async () => {
    mocks.catchUp.mockResolvedValue(brief);
    const qc = new QueryClient();
    qc.setQueryData(["chat", "rooms", "ws1"], [
      { id: "room1", unread_count: 4, mention_unread_count: 0, last_read_at: "2026-09-05T00:00:00.123456Z" },
    ]);
    const { result } = renderHook(() => useChatCatchUpUi("ws1", "room1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    expect(result.current.unreadSince).toBe("2026-09-05T00:00:00.123456Z");
    await act(async () => result.current.onCatchUp?.());
    expect(mocks.catchUp).toHaveBeenCalledWith(expect.objectContaining({ since: "2026-09-05T00:00:00.123456Z" }));
  });

  // Opening a thread marks it read, so the brief starts from the pointer the
  // mark-read call replaced, not from the one it just wrote.
  it("sends the thread's pre-open read pointer as since", async () => {
    mocks.catchUp.mockResolvedValue(brief);
    mocks.markThreadRead.mockResolvedValue("2026-09-05T00:00:00.123456Z");
    const { result } = renderHook(() => useChatCatchUpUi("ws1", "room1", "t1"), {
      wrapper: ({ children }) => wrap(<>{children}</>),
    });
    expect(mocks.markThreadRead).toHaveBeenCalledWith("t1");
    await act(async () => {});
    await act(async () => result.current.onCatchUp?.());
    expect(mocks.catchUp).toHaveBeenCalledWith(
      expect.objectContaining({ thread_root_id: "t1", since: "2026-09-05T00:00:00.123456Z" }),
    );
  });

  it("keeps how many messages were unread when the room opened", () => {
    const qc = new QueryClient();
    qc.setQueryData(["chat", "rooms", "ws1"], [
      { id: "room1", unread_count: 4, mention_unread_count: 1, last_read_at: "2026-09-05T00:00:00Z" },
    ]);
    const { result } = renderHook(() => useChatCatchUpUi("ws1", "room1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    expect(result.current.unreadCount).toBe(4);
  });

  it("summarises the room, not the open thread, from the unread line", async () => {
    mocks.catchUp.mockResolvedValue(brief);
    const { result } = renderHook(() => useChatCatchUpUi("ws1", "room1", "t1"), {
      wrapper: ({ children }) => wrap(<>{children}</>),
    });
    await act(async () => result.current.onCatchUpRoom?.());
    expect(mocks.catchUp).toHaveBeenLastCalledWith(expect.objectContaining({ room_id: "room1", thread_root_id: undefined }));
    // A retry asks for the same brief.
    await act(async () => result.current.onRetry());
    expect(mocks.catchUp).toHaveBeenLastCalledWith(expect.objectContaining({ thread_root_id: undefined }));
  });

  // The list's "Bắt kịp nhanh": the brief waits for the room to open and keep its pointer.
  it("runs a requested room's brief once that room has opened, from its pre-open pointer", async () => {
    mocks.catchUp.mockResolvedValue(brief);
    const qc = new QueryClient();
    qc.setQueryData(["chat", "rooms", "ws1"], [
      { id: "room2", unread_count: 7, mention_unread_count: 0, last_read_at: "2026-09-04T00:00:00Z" },
    ]);
    const { result, rerender } = renderHook(({ room }) => useChatCatchUpUi("ws1", room), {
      initialProps: { room: "room1" },
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    act(() => result.current.requestCatchUp("room2"));
    expect(mocks.catchUp).not.toHaveBeenCalled();

    await act(async () => rerender({ room: "room2" }));
    expect(mocks.catchUp).toHaveBeenCalledTimes(1);
    expect(mocks.catchUp).toHaveBeenCalledWith(
      expect.objectContaining({ room_id: "room2", since: "2026-09-04T00:00:00Z" }),
    );
    expect(result.current.open).toBe(true);
  });

  it("does not mark read again on close when the summary failed", async () => {
    mocks.catchUp.mockRejectedValue(new Error("ai down"));
    const { result } = setup();
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
    await act(async () => result.current.onCatchUp?.());
    expect(result.current.error).not.toBeNull();
    act(() => result.current.setOpen(false));
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
  });
});
