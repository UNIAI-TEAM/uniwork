import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { useChatCatchUpUi } from "./use-chat-catch-up-ui";

initI18n();

const mocks = vi.hoisted(() => ({ catchUp: vi.fn(), markRead: vi.fn() }));

vi.mock("@uniwork/core/ai", () => ({
  useAiCapabilities: () => ({ data: { enabled: true, ask_uni: true } }),
  useChatCatchUp: () => ({ mutateAsync: mocks.catchUp, isPending: false }),
}));

vi.mock("@uniwork/core/chat", () => ({
  chatKeys: { rooms: (ws: string) => ["chat", "rooms", ws] },
  useMarkChatRoomRead: () => ({ mutateAsync: mocks.markRead }),
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
