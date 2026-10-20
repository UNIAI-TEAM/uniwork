import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRoomRecord } from "../api/endpoints/chat";
import { chatKeys } from "./chat-keys";
import { useChatDeliveryAcks } from "./use-chat-delivery-acks";

const handlers = vi.hoisted(() => new Map<string, (payload: unknown) => void>());
const ackChatDelivered = vi.hoisted(() => vi.fn().mockResolvedValue(true));

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
vi.mock("../api/endpoints/chat-delivery", () => ({ ackChatDelivered, CHAT_DELIVERED_MAX_ROOMS: 50 }));

const room = (over: Partial<ChatRoomRecord>): ChatRoomRecord => ({
  id: "dm1",
  kind: "dm",
  name: "Hà",
  workspace_id: "ws1",
  member_user_ids: [],
  member_count: 0,
  unread_count: 0,
  mention_unread_count: 0,
  ...over,
});

function setup(rooms: ChatRoomRecord[]) {
  const qc = new QueryClient();
  qc.setQueryData(chatKeys.rooms("ws1"), rooms);
  renderHook(() => useChatDeliveryAcks("ws1", "me"), {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  return (payload: { room_id: string; sender_id: string }) => handlers.get("chat.message.created")?.(payload);
}

const ackedRooms = () => ackChatDelivered.mock.calls.flatMap(([, rooms]) => (rooms as { room_id: string }[]).map((r) => r.room_id));

describe("useChatDeliveryAcks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ackChatDelivered.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("acks the rooms the list shows unread from someone else, not read or own ones", async () => {
    setup([
      room({ id: "unread", last_message_at: "2026-10-18T10:00:00Z", last_message_sender_id: "ha", last_read_at: "2026-10-18T09:00:00Z" }),
      room({ id: "read", last_message_at: "2026-10-18T10:00:00Z", last_message_sender_id: "ha", last_read_at: "2026-10-18T10:00:00Z" }),
      room({ id: "mine", last_message_at: "2026-10-18T10:00:00Z", last_message_sender_id: "ME" }),
      room({ id: "empty" }),
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(ackedRooms()).toEqual(["unread"]);
  });

  it("acks a frame from someone else, batched, and never my own", async () => {
    const created = setup([]);
    created({ room_id: "g1", sender_id: "ha" });
    created({ room_id: "g2", sender_id: "lan" });
    created({ room_id: "g3", sender_id: "Me" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(ackChatDelivered).toHaveBeenCalledTimes(1);
    expect(ackedRooms()).toEqual(["g1", "g2"]);
  });
});
