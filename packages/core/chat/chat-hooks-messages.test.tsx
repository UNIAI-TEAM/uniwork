import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as chatApi from "../api/endpoints/chat";
import type { ChatMessageRecord } from "../api/endpoints/chat";
import { chatKeys } from "./chat-keys";
import { useDeleteChatMessage, useEditChatMessage, useSendChatFileMessage } from "./chat-hooks-messages";
import { flattenRoomTimeline, type RoomTimeline } from "./room-timeline";
import { useSendChatThreadMessage } from "./thread-hooks";

const row = (id: string, minute: number, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id,
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u1",
  sender_display_name: "An",
  kind: "text",
  body: id,
  created_at: `2026-01-01T10:${String(minute).padStart(2, "0")}:00Z`,
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  ...extra,
});

const key = chatKeys.roomMessages("ws1", "room1");

function setup(rows: ChatMessageRecord[]) {
  const qc = new QueryClient();
  qc.setQueryData<RoomTimeline>(key, { pages: [rows], pageParams: [null] });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const timeline = () => flattenRoomTimeline(qc.getQueryData<RoomTimeline>(key)!);
  const refetchedTimeline = () => invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(key));
  return { qc, wrapper, timeline, refetchedTimeline };
}

// UNI-1077: each of these refetched every loaded page of the room, while the
// server's answer (and the realtime frame after it) already said what changed.
describe("chat message mutations patch the room timeline instead of refetching it", () => {
  afterEach(() => vi.restoreAllMocks());

  it("inserts a sent file message", async () => {
    vi.spyOn(chatApi, "sendChatFileMessage").mockResolvedValue(row("f1", 2, { kind: "file" }));
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useSendChatFileMessage("ws1"), { wrapper });

    await act(() =>
      result.current.mutateAsync({ roomId: "room1", file: new Blob(["x"]), filename: "x.txt", client_msg_id: "c1" }),
    );

    expect(timeline().map((m) => m.id)).toEqual(["m1", "f1"]);
    expect(refetchedTimeline()).toBe(false);
  });

  it("replaces an edited message in place", async () => {
    vi.spyOn(chatApi, "editChatRoomMessage").mockResolvedValue(row("m1", 1, { body: "edited" }));
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useEditChatMessage("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "m1", body: "edited" }));

    expect(timeline()[0]?.body).toBe("edited");
    expect(refetchedTimeline()).toBe(false);
  });

  it("refetches when the server's answer carries no message", async () => {
    vi.spyOn(chatApi, "editChatRoomMessage").mockResolvedValue(null);
    const { wrapper, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useEditChatMessage("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "m1", body: "edited" }));

    expect(refetchedTimeline()).toBe(true);
  });

  it("drops a deleted message", async () => {
    vi.spyOn(chatApi, "deleteChatRoomMessage").mockResolvedValue(true);
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1), row("m2", 2)]);
    const { result } = renderHook(() => useDeleteChatMessage("ws1"), { wrapper });

    await act(() => result.current.mutateAsync({ roomId: "room1", messageId: "m1" }));

    expect(timeline().map((m) => m.id)).toEqual(["m2"]);
    expect(refetchedTimeline()).toBe(false);
  });

  it("counts a sent thread reply on its root", async () => {
    vi.spyOn(chatApi, "sendChatThreadMessage").mockResolvedValue(row("r1", 2, { thread_root_id: "m1" }));
    const { wrapper, timeline, refetchedTimeline } = setup([row("m1", 1)]);
    const { result } = renderHook(() => useSendChatThreadMessage("ws1", "room1"), { wrapper });

    await act(() => result.current.mutateAsync({ threadRootId: "m1", body: "r1" }));

    expect(timeline().map((m) => [m.id, m.reply_count])).toEqual([["m1", 1]]);
    expect(refetchedTimeline()).toBe(false);
  });
});
