import { describe, expect, it } from "vitest";
import type { ChatContact } from "./contacts-store";
import { chatKeys, chatRoomToGroup, dedupeDmContacts, mergeActiveDmContact, sidebarFromChatRooms, unreadMapFromRooms } from "./hooks";
import type { ChatRoomRecord } from "../api/endpoints/chat";

describe("dm contact dedupe", () => {
  const peer: ChatContact = {
    user_id: "01M14FBNCQ6BDQB5TRKJX35ESG",
    email: "longthl5@gmail.com",
    display_name: "tran hoang long",
    dm_room_id: "ROOM1",
  };

  it("dedupes contacts that only differ by missing email", () => {
    const sparse: ChatContact = {
      user_id: peer.user_id,
      email: "",
      display_name: peer.display_name,
      dm_room_id: peer.dm_room_id,
    };
    const out = dedupeDmContacts([sparse, peer]);
    expect(out).toHaveLength(1);
    expect(out[0]?.email).toBe(peer.email);
  });

  it("mergeActiveDmContact does not append a second row for the same peer", () => {
    const sparse: ChatContact = {
      user_id: peer.user_id,
      email: "",
      display_name: peer.display_name,
      dm_room_id: peer.dm_room_id,
    };
    const out = mergeActiveDmContact([sparse], peer, peer.dm_room_id ?? null);
    expect(out).toHaveLength(1);
    expect(out[0]?.email).toBe(peer.email);
  });
});

describe("chat room helpers", () => {
  it("chatKeys builds stable query keys", () => {
    expect(chatKeys.room("ws1")).toEqual(["chat", "room", "ws1"]);
    expect(chatKeys.roomMessages("ws1", "r1")).toEqual(["chat", "room-messages", "ws1", "r1"]);
    expect(chatKeys.block("ws1", "u1")).toEqual(["chat", "block", "ws1", "u1"]);
  });

  it("unreadMapFromRooms only includes positive counts", () => {
    const rooms: ChatRoomRecord[] = [
      { id: "a", kind: "dm", name: "a", workspace_id: "ws", member_user_ids: [], unread_count: 2, mention_unread_count: 0 },
      { id: "b", kind: "dm", name: "b", workspace_id: "ws", member_user_ids: [], unread_count: 0, mention_unread_count: 0 },
    ];
    expect(unreadMapFromRooms(rooms)).toEqual({ a: 2 });
  });

  it("sidebarFromChatRooms splits workspace, dm, and group rooms", () => {
    const rooms: ChatRoomRecord[] = [
      { id: "w", kind: "workspace", name: "General", workspace_id: "ws", member_user_ids: [], unread_count: 0, mention_unread_count: 0 },
      {
        id: "d",
        kind: "dm",
        name: "Peer",
        workspace_id: "ws",
        member_user_ids: ["u1"],
        peer_user_id: "u1",
        peer_display_name: "Peer",
        unread_count: 1,
        mention_unread_count: 0,
      },
      { id: "g", kind: "group", name: "Team", workspace_id: "ws", member_user_ids: ["u1", "u2"], unread_count: 0, mention_unread_count: 0 },
    ];
    const sidebar = sidebarFromChatRooms(rooms);
    expect(sidebar.workspaceRoom?.id).toBe("w");
    expect(sidebar.contacts).toHaveLength(1);
    expect(chatRoomToGroup(rooms[2]!)).toEqual({
      id: "g",
      name: "Team",
      room_id: "g",
      member_user_ids: ["u1", "u2"],
    });
    expect(sidebar.groups[0]?.room_id).toBe("g");
  });
});