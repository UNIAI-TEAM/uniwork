import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/endpoints/chat";
import type { ChatMessageRecord, ChatRoomRecord } from "../api/endpoints/chat";
import { resetAuthStoreForTests, setSessionUser } from "../auth";
import type { User } from "../types/user";
import { chatKeys } from "./chat-keys";
import {
  useChatRoomMessages,
  useChatUnreadBadge,
  useSetChatRoomAvatar,
  useSetChatRoomMuted,
} from "./chat-hooks-rooms";

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const message = (n: number): ChatMessageRecord => ({
  id: `m${String(n).padStart(4, "0")}`,
  cursor: `m${String(n).padStart(4, "0")}`,
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u2",
  sender_display_name: "Bob",
  kind: "text",
  body: String(n),
  created_at: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(),
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
});

/** A server room: the newest `limit` rows older than the cursor, oldest first. */
function serveRoom(rows: () => ChatMessageRecord[]) {
  return vi.spyOn(chatApi, "listChatRoomMessages").mockImplementation(async (_ws, _room, options) => {
    const older = rows().filter((row) => !options?.cursor || row.id < options.cursor);
    return older.slice(Math.max(0, older.length - (options?.limit ?? 50)));
  });
}

function wrapper(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("useChatRoomMessages", () => {
  beforeEach(() => setSessionUser(user));
  afterEach(() => {
    vi.restoreAllMocks();
    resetAuthStoreForTests();
  });

  // H4: the newest page lived in the query and older pages in the panel, so a
  // refetch after new messages left a hole between them.
  it("stays contiguous when it refetches after older pages and new messages", async () => {
    let room = Array.from({ length: 200 }, (_, n) => message(n));
    const list = serveRoom(() => room);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChatRoomMessages("ws1", "room1", 80), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data).toHaveLength(80));

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(list).toHaveBeenLastCalledWith("ws1", "room1", { cursor: "m0120", limit: 50, mark_read: false });
    await waitFor(() => expect(result.current.data).toHaveLength(130));

    room = [...room, ...Array.from({ length: 100 }, (_, n) => message(200 + n))];
    await act(async () => {
      await qc.invalidateQueries({ queryKey: chatKeys.roomMessages("ws1", "room1") });
    });

    await waitFor(() => expect(result.current.data?.at(-1)?.body).toBe("299"));
    const ns = (result.current.data ?? []).map((row) => Number(row.body));
    expect(ns).toEqual(Array.from({ length: ns.length }, (_, i) => ns[0]! + i));
  });

  it("offers no older page once the room's history is loaded", async () => {
    serveRoom(() => Array.from({ length: 10 }, (_, n) => message(n)));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChatRoomMessages("ws1", "room1", 80), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data).toHaveLength(10));
    expect(result.current.hasNextPage).toBe(false);
  });
});

const serverRoom = (id: string, unread: number, mentions: number, muted = false): ChatRoomRecord => ({
  id, kind: "group", name: id, workspace_id: "ws1", member_user_ids: [], member_count: 0,
  unread_count: unread, mention_unread_count: mentions, notifications_muted: muted,
});

// UNI-1697: the mute lives on the server, so every device reads it from the rooms list.
describe("room mute", () => {
  beforeEach(() => setSessionUser(user));
  afterEach(() => {
    vi.restoreAllMocks();
    resetAuthStoreForTests();
  });

  it("useChatUnreadBadge counts only mentions of a room the server says is muted", async () => {
    vi.spyOn(chatApi, "listChatRooms").mockResolvedValue([serverRoom("a", 2, 0), serverRoom("m", 5, 1, true)]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChatUnreadBadge("ws1"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current).toBe(3));
  });

  it("useSetChatRoomMuted flips the row at once and restores it when the server refuses", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(chatKeys.rooms("ws1"), [serverRoom("a", 0, 0, false)]);
    let answer: (ok: boolean) => void = () => {};
    vi.spyOn(chatApi, "setChatRoomMuted").mockImplementation(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    const { result } = renderHook(() => useSetChatRoomMuted("ws1"), { wrapper: wrapper(qc) });
    const muted = () => qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.notifications_muted;

    act(() => result.current.mutate({ roomId: "a", muted: true }));
    await waitFor(() => expect(muted()).toBe(true));
    await act(async () => answer(false));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(muted()).toBe(false);
  });

  it("useSetChatRoomMuted refreshes the switcher's unread summary once the server agrees", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    vi.spyOn(chatApi, "setChatRoomMuted").mockResolvedValue(true);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSetChatRoomMuted("ws1"), { wrapper: wrapper(qc) });

    await act(() => result.current.mutateAsync({ roomId: "a", muted: true }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.unreadSummary() });
  });
});

describe("group avatar", () => {
  afterEach(() => vi.restoreAllMocks());

  it("useSetChatRoomAvatar uploads a file, removes on null, and refreshes the room list", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const upload = vi.spyOn(chatApi, "uploadChatRoomAvatar").mockResolvedValue(null);
    const remove = vi.spyOn(chatApi, "removeChatRoomAvatar").mockResolvedValue(null);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useSetChatRoomAvatar("ws1"), { wrapper: wrapper(qc) });
    const file = new File(["png"], "g.png", { type: "image/png" });

    await act(() => result.current.mutateAsync({ roomId: "g1", file }));
    expect(upload).toHaveBeenCalledWith("ws1", "g1", file);
    expect(remove).not.toHaveBeenCalled();
    await act(() => result.current.mutateAsync({ roomId: "g1", file: null }));
    expect(remove).toHaveBeenCalledWith("ws1", "g1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.rooms("ws1") });
  });
});
