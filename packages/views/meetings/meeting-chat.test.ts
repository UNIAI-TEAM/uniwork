import { describe, expect, it } from "vitest";
import {
  dedupePersistedChatMessages,
  groupChatMessages,
  mergeLiveChatArchive,
  toChatItems,
  toEphemeralChatItems,
  type MeetingChatItem,
} from "./meeting-chat";

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

describe("dedupePersistedChatMessages", () => {
  it("keeps the first row for each id", () => {
    const rows = dedupePersistedChatMessages([
      { id: "1", message: "a", sent_at: "2026-08-29T02:00:00Z" },
      { id: "1", message: "a-dup", sent_at: "2026-08-29T02:00:01Z" },
      { id: "2", message: "b", sent_at: "2026-08-29T02:00:02Z" },
    ]);
    expect(rows.map((m) => m.id)).toEqual(["1", "2"]);
    expect(rows[0]?.message).toBe("a");
  });

  it("collapses double POST with different ids in the same 2s window", () => {
    const rows = dedupePersistedChatMessages([
      {
        id: "a1",
        sender_identity: "uw_participant_x",
        message: "lô",
        sent_at: "2026-08-29T02:00:00.100Z",
      },
      {
        id: "a2",
        sender_identity: "uw_participant_x",
        message: "lô",
        sent_at: "2026-08-29T02:00:00.500Z",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("a1");
  });

  it("ignores rows without ids when deduping", () => {
    const rows = dedupePersistedChatMessages([
      { id: "", message: "orphan", sent_at: "2026-08-29T02:00:00Z" },
      { id: "1", message: "kept", sent_at: "2026-08-29T02:00:01Z" },
    ]);
    expect(rows.map((m) => m.id)).toEqual(["1"]);
  });
});

describe("toChatItems", () => {
  it("maps persisted rows and marks the local sender", () => {
    const items = toChatItems(
      [
        {
          id: "db1",
          sender_identity: "uw_participant_me",
          sender_name: "Me",
          message: "hello",
          sent_at: "2026-08-29T02:00:00Z",
        },
        {
          id: "db2",
          sender_identity: "uw_participant_other",
          sender_name: "Other",
          message: "hi",
          sent_at: "2026-08-29T02:00:01Z",
        },
      ],
      "uw_participant_me",
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.isLocal).toBe(true);
    expect(items[1]?.isLocal).toBe(false);
    expect(items.map((m) => m.message)).toEqual(["hello", "hi"]);
  });

  it("falls back to identity when sender_name is missing", () => {
    const items = toChatItems(
      [{ id: "db3", sender_identity: "guest-1", message: "hey", sent_at: "2026-08-29T02:00:02Z" }],
      "",
    );
    expect(items[0]?.fromName).toBe("guest-1");
    expect(items[0]?.isLocal).toBe(false);
  });
});

describe("toEphemeralChatItems", () => {
  it("sorts ephemeral LiveKit messages chronologically", () => {
    const items = toEphemeralChatItems([
      {
        id: "lk2",
        fromIdentity: "b",
        fromName: "B",
        isLocal: false,
        message: "second",
        timestamp: 200,
      },
      {
        id: "lk1",
        fromIdentity: "a",
        fromName: "A",
        isLocal: true,
        message: "first",
        timestamp: 100,
      },
    ]);
    expect(items.map((m) => m.message)).toEqual(["first", "second"]);
  });
});
