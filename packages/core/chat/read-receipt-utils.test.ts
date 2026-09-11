import { describe, expect, it } from "vitest";
import { isMessageSeenByPeer, shouldShowReadReceipt } from "./read-receipt-utils";

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
