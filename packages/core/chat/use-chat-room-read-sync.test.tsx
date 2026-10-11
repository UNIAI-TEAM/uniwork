import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoomRecord } from "../api/endpoints/chat";
import { chatKeys } from "./chat-keys";
import { useChatRoomReadSync } from "./use-chat-room-read-sync";

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());

vi.mock("../realtime", () => ({
  useOptionalWS: () => ({
    client: {
      on: (event: string, handler: (payload: unknown) => void) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      },
    },
  }),
}));

const room = (over: Partial<ChatRoomRecord>): ChatRoomRecord => ({
  id: "dm1",
  kind: "dm",
  name: "Bob",
  workspace_id: "ws1",
  member_user_ids: [],
  unread_count: 2,
  mention_unread_count: 1,
  ...over,
});

function setup(rooms: ChatRoomRecord[]) {
  const qc = new QueryClient();
  qc.setQueryData(chatKeys.rooms("ws1"), rooms);
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  renderHook(() => useChatRoomReadSync("ws1", "u1"), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  const read = (payload: { room_id: string; user_id: string }) => handlers.get("chat.room.read")?.(payload);
  return { qc, invalidate, read };
}

describe("useChatRoomReadSync", () => {
  it("clears the badge locally when I read a room", () => {
    const { qc, invalidate, read } = setup([room({})]);
    read({ room_id: "dm1", user_id: "U1" });
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]).toMatchObject({
      unread_count: 0,
      mention_unread_count: 0,
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  // C3: every read by someone else refetched the whole sidebar for everyone.
  it("moves the DM peer's read receipt locally instead of refetching the sidebar", () => {
    const { qc, invalidate, read } = setup([
      room({ last_message_at: "2026-01-01T10:05:00Z", peer_last_read_at: "2026-01-01T10:00:00Z" }),
      room({ id: "g1", kind: "group", last_message_at: "2026-01-01T10:05:00Z" }),
    ]);
    read({ room_id: "dm1", user_id: "u2" });
    read({ room_id: "g1", user_id: "u2" });
    const rooms = qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"));
    expect(rooms?.[0]).toMatchObject({ peer_last_read_at: "2026-01-01T10:05:00Z", unread_count: 2 });
    expect(rooms?.[1]?.peer_last_read_at).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("never moves the peer's read receipt backwards", () => {
    const { qc, read } = setup([
      room({ last_message_at: "2026-01-01T10:00:00Z", peer_last_read_at: "2026-01-01T10:05:00Z" }),
    ]);
    read({ room_id: "dm1", user_id: "u2" });
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("ws1"))?.[0]?.peer_last_read_at).toBe(
      "2026-01-01T10:05:00Z",
    );
  });
});
