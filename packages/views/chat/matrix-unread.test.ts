import { describe, expect, it } from "vitest";
import { countUnreadMessagesInRoom } from "./matrix-unread";

function mockRoom(options: {
  messages: Array<{ id: string; sender: string; body: string; ts: number }>;
  readUpTo?: string | null;
  notificationCount?: number;
}) {
  const events = options.messages.map((m) => ({
    getId: () => m.id,
    getType: () => "m.room.message",
    getSender: () => m.sender,
    getTs: () => m.ts,
    getContent: () => ({ body: m.body }),
  }));

  const readEvent = options.readUpTo
    ? events.find((ev) => ev.getId() === options.readUpTo)
    : undefined;

  return {
    getUnreadNotificationCount: () => options.notificationCount ?? 0,
    getLiveTimeline: () => ({ getEvents: () => events }),
    getEventReadUpTo: () => options.readUpTo ?? null,
    findEventById: (id: string) => events.find((ev) => ev.getId() === id),
  };
}

describe("countUnreadMessagesInRoom", () => {
  const me = "@me:localhost";

  it("counts all messages from others when no read receipt exists", () => {
    const room = mockRoom({
      messages: [
        { id: "$1", sender: "@other:localhost", body: "hi", ts: 1 },
        { id: "$2", sender: me, body: "hey", ts: 2 },
        { id: "$3", sender: "@other:localhost", body: "again", ts: 3 },
      ],
    });
    expect(countUnreadMessagesInRoom(room as never, me)).toBe(2);
  });

  it("counts only messages after the read receipt", () => {
    const room = mockRoom({
      readUpTo: "$2",
      messages: [
        { id: "$1", sender: "@other:localhost", body: "old", ts: 1 },
        { id: "$2", sender: me, body: "read here", ts: 2 },
        { id: "$3", sender: "@other:localhost", body: "new", ts: 3 },
      ],
    });
    expect(countUnreadMessagesInRoom(room as never, me)).toBe(1);
  });

  it("returns zero when everything is read", () => {
    const room = mockRoom({
      readUpTo: "$2",
      messages: [
        { id: "$1", sender: "@other:localhost", body: "old", ts: 1 },
        { id: "$2", sender: "@other:localhost", body: "latest", ts: 2 },
      ],
    });
    expect(countUnreadMessagesInRoom(room as never, me)).toBe(0);
  });
});
