import { describe, expect, it } from "vitest";
import type { ChatRoomRecord } from "../api/endpoints/chat";
import { chatUnreadBadge, sidebarFromChatRooms } from "./chat-room-helpers";

const room = (id: string, unread: number, mentions: number) =>
  ({
    id, kind: "channel", name: id, workspace_id: "ws", member_user_ids: [], member_count: 0, unread_count: unread,
    mention_unread_count: mentions, notifications_muted: id === "muted",
  }) as ChatRoomRecord;

describe("chatUnreadBadge", () => {
  it("counts every unread message, and only mentions in a muted room", () => {
    const rooms = [room("a", 2, 1), room("muted", 7, 1), room("b", 0, 0)];
    expect(chatUnreadBadge(rooms)).toBe(3);
    expect(chatUnreadBadge([])).toBe(0);
  });
});

describe("sidebarFromChatRooms", () => {
  it("gives a group row the photo its room carries", () => {
    const group = { ...room("g1", 0, 0), kind: "group", avatar_url: "https://s.test/g.png" } as ChatRoomRecord;
    expect(sidebarFromChatRooms([group]).groups[0]?.avatar_url).toBe("https://s.test/g.png");
  });
});
