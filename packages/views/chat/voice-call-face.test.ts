import { describe, expect, it } from "vitest";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { identityTint } from "../people/identity-tint";
import { chatRoomFaceOf } from "./voice-call-face";

function room(overrides: Partial<ChatRoomRecord>): ChatRoomRecord {
  return {
    id: "room-1",
    kind: "group",
    name: "Ra mắt UniWork Q4",
    workspace_id: "ws-1",
    member_user_ids: [],
    member_count: 0,
    unread_count: 0,
    mention_unread_count: 0,
    ...overrides,
  } as ChatRoomRecord;
}

describe("chatRoomFaceOf", () => {
  it("draws a DM as the other person: their initials on their own tint, round", () => {
    expect(chatRoomFaceOf(room({ kind: "dm", peer_user_id: "u-ha" }), "Nguyễn Thu Hà")).toEqual({
      tint: identityTint("u-ha"),
      text: "TH",
      square: false,
    });
  });

  it("draws a group as its initials on the room's tint, a squircle, with its photo", () => {
    expect(chatRoomFaceOf(room({ avatar_url: "https://x/p.png" }), "Ra mắt UniWork Q4")).toEqual({
      tint: identityTint("room-1"),
      text: "RM",
      square: true,
      imageUrl: "https://x/p.png",
    });
  });

  it("draws a channel as its #", () => {
    expect(chatRoomFaceOf(room({ kind: "channel" }), "release")).toMatchObject({ text: "#", square: true });
  });

  it("falls back to the name's initials on the brand before the room loads", () => {
    expect(chatRoomFaceOf(undefined, "Hoàng Lan")).toEqual({ tint: "blue", text: "HL", square: false });
  });
});
