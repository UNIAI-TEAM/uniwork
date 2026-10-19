import { describe, expect, it } from "vitest";
import {
  furthestReadAt,
  isMessageSeenByPeer,
  latestSeenOwnMessageIndex,
  seenByCount,
  deliveredToAllAt,
  seenByMembers,
  shouldShowReadReceipt,
} from "./read-receipt-utils";

describe("isMessageSeenByPeer", () => {
  it("returns false without a peer cursor", () => {
    expect(isMessageSeenByPeer(Date.parse("2026-03-26T10:00:00Z"), undefined)).toBe(false);
  });

  it("returns true when the peer has read past the message", () => {
    expect(
      isMessageSeenByPeer(
        Date.parse("2026-03-26T10:00:00Z"),
        "2026-03-26T10:05:00Z",
      ),
    ).toBe(true);
  });

  it("returns false when the peer has not reached the message", () => {
    expect(
      isMessageSeenByPeer(
        Date.parse("2026-03-26T10:10:00Z"),
        "2026-03-26T10:05:00Z",
      ),
    ).toBe(false);
  });
});

describe("shouldShowReadReceipt", () => {
  const me = "USER1";
  const peer = "USER2";
  const cursor = "2026-03-26T10:05:00Z";

  it("marks only the latest seen own message", () => {
    const messages = [
      { sender: me, ts: Date.parse("2026-03-26T10:00:00Z") },
      { sender: peer, ts: Date.parse("2026-03-26T10:01:00Z") },
      { sender: me, ts: Date.parse("2026-03-26T10:04:00Z") },
      { sender: me, ts: Date.parse("2026-03-26T10:10:00Z") },
    ];
    expect(
      shouldShowReadReceipt({ messages, index: 0, currentUserId: me, peerLastReadAt: cursor }),
    ).toBe(false);
    expect(
      shouldShowReadReceipt({ messages, index: 2, currentUserId: me, peerLastReadAt: cursor }),
    ).toBe(true);
    expect(
      shouldShowReadReceipt({ messages, index: 3, currentUserId: me, peerLastReadAt: cursor }),
    ).toBe(false);
  });
});

describe("latestSeenOwnMessageIndex", () => {
  const messages = [
    { sender: "me", ts: 1_000 },
    { sender: "peer", ts: 2_000 },
    { sender: "me", ts: 3_000 },
    { sender: "me", ts: 5_000 },
  ];

  it("picks the latest own message the peer has read, matching shouldShowReadReceipt", () => {
    const peer = new Date(4_000).toISOString();
    const index = latestSeenOwnMessageIndex(messages, "me", peer);
    expect(index).toBe(2);
    messages.forEach((_, i) => {
      expect(shouldShowReadReceipt({ messages, index: i, currentUserId: "me", peerLastReadAt: peer })).toBe(
        i === index,
      );
    });
  });

  it("is -1 without a cursor or when nothing of mine was read", () => {
    expect(latestSeenOwnMessageIndex(messages, "me", null)).toBe(-1);
    expect(latestSeenOwnMessageIndex(messages, "me", new Date(500).toISOString())).toBe(-1);
  });
});

describe("seenByMembers / seenByCount", () => {
  const message = { created_at: "2026-03-26T10:00:00Z" };
  const members = [
    { user_id: "SENDER", last_read_at: "2026-03-26T10:05:00Z" },
    { user_id: "AT", last_read_at: "2026-03-26T10:00:00.123456Z" },
    { user_id: "PAST", last_read_at: "2026-03-26T10:01:00Z" },
    { user_id: "BEFORE", last_read_at: "2026-03-26T09:59:59.999Z" },
    { user_id: "NEVER" },
    { user_id: "NULL", last_read_at: null },
    { user_id: "JUNK", last_read_at: "yesterday" },
  ];

  it("counts members whose cursor reached the message, never the sender", () => {
    expect(seenByMembers(message, members, "SENDER").map((m) => m.user_id)).toEqual(["AT", "PAST"]);
    expect(seenByCount(message, members, "SENDER")).toBe(2);
  });

  it("counts a cursor at the message's own sub-second time", () => {
    const precise = { created_at: "2026-03-26T10:00:00.123456Z" };
    expect(seenByCount(precise, [{ user_id: "AT", last_read_at: "2026-03-26T10:00:00.123456Z" }], "X")).toBe(1);
  });

  it("sees nothing of a message whose time does not parse", () => {
    expect(seenByCount({ created_at: "" }, members, "SENDER")).toBe(0);
  });
});

describe("furthestReadAt", () => {
  it("is the latest cursor among the others, ignoring mine and unreadable ones", () => {
    const members = [
      { user_id: "ME", last_read_at: "2026-03-26T11:00:00Z" },
      { user_id: "A", last_read_at: "2026-03-26T10:00:00Z" },
      { user_id: "B", last_read_at: "2026-03-26T10:30:00.5Z" },
      { user_id: "C" },
      { user_id: "D", last_read_at: "junk" },
    ];
    expect(furthestReadAt(members, "ME")).toBe("2026-03-26T10:30:00.5Z");
  });

  it("is null when nobody else has read", () => {
    expect(furthestReadAt([{ user_id: "ME", last_read_at: "2026-03-26T11:00:00Z" }, { user_id: "A" }], "ME")).toBeNull();
  });
});

describe("deliveredToAllAt", () => {
  const at = (iso: string) => new Date(iso).toISOString();

  it("is the earliest of the others' cursors, a read counting as delivered", () => {
    const members = [
      { user_id: "ME", last_delivered_at: "2026-03-26T09:00:00Z" },
      { user_id: "A", last_delivered_at: "2026-03-26T10:05:00Z" },
      { user_id: "B", last_read_at: "2026-03-26T10:02:00Z", last_delivered_at: "2026-03-26T10:01:00Z" },
    ];
    expect(deliveredToAllAt(members, "ME")).toBe(at("2026-03-26T10:02:00Z"));
  });

  it("is null while someone else has received nothing, or nobody else is there", () => {
    expect(deliveredToAllAt([{ user_id: "A", last_delivered_at: "2026-03-26T10:00:00Z" }, { user_id: "B" }], "ME")).toBeNull();
    expect(deliveredToAllAt([{ user_id: "ME", last_delivered_at: "2026-03-26T10:00:00Z" }], "ME")).toBeNull();
    expect(deliveredToAllAt([{ user_id: "A", last_delivered_at: "not a time" }], "ME")).toBeNull();
  });
});
