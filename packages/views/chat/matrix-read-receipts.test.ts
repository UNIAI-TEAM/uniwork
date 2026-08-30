import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./chat-messages";
import { ownMessageIdWithReadReceipt } from "./matrix-read-receipts";

function mockRoom(readUpToId: string | null, readTs: number) {
  return {
    getEventReadUpTo: (userId: string) => (userId === "@bob:localhost" ? readUpToId : null),
    findEventById: (id: string) =>
      id === readUpToId ? { getTs: () => readTs } : undefined,
  };
}

describe("ownMessageIdWithReadReceipt", () => {
  const myId = "@me:localhost";
  const bobId = "@bob:localhost";
  const messages: ChatMessage[] = [
    { id: "$1", sender: myId, body: "a", ts: 100, reactions: {} },
    { id: "$2", sender: bobId, body: "b", ts: 200, reactions: {} },
    { id: "$3", sender: myId, body: "c", ts: 300, reactions: {} },
    { id: "$4", sender: myId, body: "d", ts: 400, reactions: {} },
  ];

  it("marks the last own message read up to the receipt", () => {
    const room = mockRoom("$4", 400);
    expect(ownMessageIdWithReadReceipt(room as never, messages, myId, bobId)).toBe("$4");
  });

  it("marks an earlier own message when receipt is before later sends", () => {
    const room = mockRoom("$2", 200);
    expect(ownMessageIdWithReadReceipt(room as never, messages, myId, bobId)).toBe("$1");
  });

  it("returns null when reader has not read anything", () => {
    const room = mockRoom(null, 0);
    expect(ownMessageIdWithReadReceipt(room as never, messages, myId, bobId)).toBeNull();
  });

  it("returns null without a reader", () => {
    const room = mockRoom("$4", 400);
    expect(ownMessageIdWithReadReceipt(room as never, messages, myId, null)).toBeNull();
  });
});
