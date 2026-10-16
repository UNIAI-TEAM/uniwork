import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/endpoints/chat";
import type { ChatMessageRecord } from "../api/endpoints/chat";
import { resetAuthStoreForTests, setSessionUser } from "../auth";
import type { User } from "../types/user";
import { useChatThreadMessages } from "./thread-hooks";

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const message = (id: string, n: number, threadRootId?: string): ChatMessageRecord => ({
  id,
  cursor: `c-${id}`,
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u2",
  sender_display_name: "Bob",
  kind: "text",
  body: id,
  created_at: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(),
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  ...(threadRootId ? { thread_root_id: threadRootId } : {}),
});

const root = message("root1", 0);
const replies = Array.from({ length: 60 }, (_, n) => message(`r${String(n + 1).padStart(2, "0")}`, n + 1, "root1"));

function wrapper(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("useChatThreadMessages", () => {
  beforeEach(() => setSessionUser(user));
  afterEach(() => {
    vi.restoreAllMocks();
    resetAuthStoreForTests();
  });

  it("pages older replies from the oldest reply's cursor, not the root's, and stops on a short page", async () => {
    // The server: the root then the newest 50 replies, then 10 older ones.
    const list = vi
      .spyOn(chatApi, "listChatThreadMessages")
      .mockImplementation(async (_ws, _room, _root, opts) =>
        opts?.cursor ? replies.slice(0, 10) : [root, ...replies.slice(10)],
      );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChatThreadMessages("ws1", "room1", "root1"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data).toHaveLength(51));
    expect(list).toHaveBeenLastCalledWith("ws1", "room1", "root1", { limit: 50 });
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(list).toHaveBeenLastCalledWith("ws1", "room1", "root1", { cursor: "c-r11", limit: 50 });
    await waitFor(() => expect(result.current.data).toHaveLength(61));
    expect(result.current.data?.map((m) => m.id)).toEqual(["root1", ...replies.map((m) => m.id)]);
    expect(result.current.hasNextPage).toBe(false);
  });
});
