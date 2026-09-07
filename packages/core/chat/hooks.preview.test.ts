import { describe, expect, it } from "vitest";
import { roomPreviewMapFromRooms } from "./hooks";

describe("roomPreviewMapFromRooms", () => {
  it("maps last message fields by room id", () => {
    expect(
      roomPreviewMapFromRooms([
        {
          id: "room1",
          kind: "dm",
          name: "Peer",
          workspace_id: "ws1",
          member_user_ids: [],
          unread_count: 0,
          mention_unread_count: 0,
          last_message_body: "hello",
          last_message_kind: "text",
          last_message_sender_id: "u2",
          last_message_sender_name: "Binh",
          last_message_at: "2026-03-26T10:00:00Z",
        },
      ]),
    ).toEqual({
      room1: {
        body: "hello",
        kind: "text",
        senderId: "u2",
        senderName: "Binh",
        createdAt: "2026-03-26T10:00:00Z",
      },
    });
  });
});
