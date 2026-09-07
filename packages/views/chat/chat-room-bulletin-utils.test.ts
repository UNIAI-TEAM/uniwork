import { describe, expect, it } from "vitest";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { filterBulletinMessages, isBulletinMessage } from "./chat-room-bulletin-utils";

describe("chat-room-bulletin-utils", () => {
  const rows: ChatMessageRecord[] = [
    {
      id: "m1",
      room_id: "r1",
      workspace_id: "ws1",
      sender_id: "u1",
      sender_display_name: "U1",
      body: "plain",
      kind: "text",
      created_at: "2026-03-26T10:00:00Z",
      pinned: true,
      mentioned_user_ids: [],
      reactions: {},
    },
    {
      id: "m2",
      room_id: "r1",
      workspace_id: "ws1",
      sender_id: "u1",
      sender_display_name: "U1",
      body: "",
      kind: "note",
      created_at: "2026-03-26T11:00:00Z",
      pinned: false,
      mentioned_user_ids: [],
      reactions: {},
      note: { body: "team note", pin_to_top: false },
    },
    {
      id: "m3",
      room_id: "r1",
      workspace_id: "ws1",
      sender_id: "u1",
      sender_display_name: "U1",
      body: "",
      kind: "poll",
      created_at: "2026-03-26T09:00:00Z",
      pinned: false,
      mentioned_user_ids: [],
      reactions: {},
      poll: {
        question: "Lunch?",
        options: [],
        settings: {},
      } as unknown as ChatMessageRecord["poll"],
    },
  ];

  it("detects bulletin messages", () => {
    expect(isBulletinMessage(rows[0]!)).toBe(true);
    expect(isBulletinMessage(rows[1]!)).toBe(true);
    expect(
      isBulletinMessage({
        ...rows[0]!,
        id: "m0",
        pinned: false,
        kind: "text",
      }),
    ).toBe(false);
  });

  it("filters tabs and sorts newest first", () => {
    expect(filterBulletinMessages([...rows], "notes").map((row) => row.id)).toEqual(["m2"]);
    expect(filterBulletinMessages([...rows], "polls").map((row) => row.id)).toEqual(["m3"]);
    expect(filterBulletinMessages([...rows], "pinned").map((row) => row.id)).toEqual(["m1"]);
    expect(filterBulletinMessages([...rows], "all").map((row) => row.id)).toEqual(["m2", "m1", "m3"]);
  });
});
