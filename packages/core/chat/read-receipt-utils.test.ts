import { describe, expect, it } from "vitest";
import { isMessageSeenByPeer, latestSeenOwnMessageIndex, shouldShowReadReceipt } from "./read-receipt-utils";

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
