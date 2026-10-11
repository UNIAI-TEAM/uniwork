import { describe, expect, it } from "vitest";
import type { ChatRoomRecord } from "../api/endpoints/chat";
import { chatUnreadBadge } from "./chat-room-helpers";

const room = (id: string, unread: number, mentions: number) =>
  ({ id, kind: "channel", name: id, workspace_id: "ws", member_user_ids: [], unread_count: unread, mention_unread_count: mentions }) as ChatRoomRecord;

describe("chatUnreadBadge", () => {
  it("counts every unread message, and only mentions in a muted room", () => {
    const rooms = [room("a", 2, 1), room("muted", 7, 1), room("b", 0, 0)];
    expect(chatUnreadBadge(rooms, (id) => id === "muted")).toBe(3);
    expect(chatUnreadBadge([], () => false)).toBe(0);
  });
});
