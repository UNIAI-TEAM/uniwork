import { describe, expect, it } from "vitest";
import { groupChatMessages, mergeChatMessages, mergeLiveChatArchive, type MeetingChatItem } from "./meeting-chat";

function item(partial: Partial<MeetingChatItem> & Pick<MeetingChatItem, "id" | "fromIdentity" | "message">): MeetingChatItem {
  return {
    fromName: partial.fromIdentity,
    isLocal: false,
    timestamp: 0,
    ...partial,
  };
}

describe("groupChatMessages", () => {
  it("groups consecutive messages from the same sender", () => {
    const groups = groupChatMessages([
      item({ id: "1", fromIdentity: "a", fromName: "An", message: "hi", timestamp: 1 }),
      item({ id: "2", fromIdentity: "a", fromName: "An", message: "there", timestamp: 2 }),
      item({ id: "3", fromIdentity: "b", fromName: "Bình", message: "ok", timestamp: 3 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((m) => m.message)).toEqual(["hi", "there"]);
    expect(groups[1]?.fromIdentity).toBe("b");
  });

  it("starts a new group when the sender changes back", () => {
    const groups = groupChatMessages([
      item({ id: "1", fromIdentity: "a", message: "1" }),
      item({ id: "2", fromIdentity: "b", message: "2" }),
      item({ id: "3", fromIdentity: "a", message: "3" }),
    ]);
    expect(groups.map((g) => g.fromIdentity)).toEqual(["a", "b", "a"]);
  });
});

describe("mergeLiveChatArchive", () => {
  it("keeps prior live messages when useChat clears on reconnect", () => {
    const prior = [
      {
        id: "lk1",
        fromIdentity: "b",
        fromName: "Bình",
        isLocal: false,
        message: "live only",
        timestamp: 100,
      },
    ];
    expect(mergeLiveChatArchive(prior, [])).toEqual(prior);
    expect(
      mergeLiveChatArchive(prior, [
        {
          id: "lk2",
          fromIdentity: "a",
          fromName: "An",
          isLocal: false,
          message: "new",
          timestamp: 200,
        },
      ]),
    ).toEqual([
      prior[0],
      {
        id: "lk2",
        fromIdentity: "a",
        fromName: "An",
        isLocal: false,
        message: "new",
        timestamp: 200,
      },
    ]);
  });
});

describe("mergeChatMessages", () => {
  it("merges persisted history with live messages and dedupes near matches", () => {
    const merged = mergeChatMessages(
      [
        {
          id: "db1",
          sender_identity: "a",
          sender_name: "An",
          message: "saved",
          sent_at: "2026-08-29T02:00:00Z",
        },
      ],
      [
        {
          id: "lk1",
          fromIdentity: "a",
          fromName: "An",
          isLocal: false,
          message: "saved",
          timestamp: Date.parse("2026-08-29T02:00:01Z"),
        },
        {
          id: "lk2",
          fromIdentity: "b",
          fromName: "Bình",
          isLocal: false,
          message: "live only",
          timestamp: Date.parse("2026-08-29T02:00:02Z"),
        },
      ],
      "me",
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.message)).toEqual(["saved", "live only"]);
  });
});
