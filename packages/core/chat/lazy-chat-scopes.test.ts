import { describe, expect, it } from "vitest";
import { selectLazyChatScopeRoomIds } from "./lazy-chat-scopes";
import type { ChatRoomRecord } from "../api/endpoints/chat";

function room(id: string, unread = 0): ChatRoomRecord {
  return {
    id,
    kind: "dm",
    name: id,
    workspace_id: "ws1",
    member_user_ids: [],
    unread_count: unread,
    mention_unread_count: 0,
  };
}

describe("selectLazyChatScopeRoomIds", () => {
  it("always includes the active room", () => {
    const rooms = Array.from({ length: 40 }, (_, i) => room(`r${i}`));
    const ids = selectLazyChatScopeRoomIds({
      rooms,
      activeRoomId: "r39",
      maxSubscriptions: 10,
    });
    expect(ids).toContain("r39");
    expect(ids).toHaveLength(10);
  });

  it("prioritizes rooms with unread before recency fill", () => {
    const rooms = [room("old", 0), room("unread-a", 2), room("unread-b", 1)];
    const ids = selectLazyChatScopeRoomIds({
      rooms,
      activeRoomId: "old",
      maxSubscriptions: 3,
    });
    expect(ids).toEqual(["old", "unread-a", "unread-b"]);
  });

  it("respects the subscription cap", () => {
    const rooms = Array.from({ length: 50 }, (_, i) => room(`r${i}`, i % 5 === 0 ? 1 : 0));
    expect(
      selectLazyChatScopeRoomIds({
        rooms,
        activeRoomId: "r0",
        maxSubscriptions: 25,
      }),
    ).toHaveLength(25);
  });
});
