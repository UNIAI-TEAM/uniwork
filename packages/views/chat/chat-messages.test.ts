import { describe, expect, it } from "vitest";
import { CHAT_MESSAGE_INITIAL, readRoomMessages } from "./chat-messages";

describe("readRoomMessages", () => {
  it("returns only the most recent messages when limit is exceeded", () => {
    const events = Array.from({ length: 120 }, (_, index) => ({
      getType: () => "m.room.message",
      getId: () => `$${index}`,
      getSender: () => "@a:localhost",
      getTs: () => index,
      getContent: () => ({ body: `msg-${index}` }),
    }));

    const client = {
      getRoom: () => ({
        getLiveTimeline: () => ({ getEvents: () => events }),
      }),
    };

    const messages = readRoomMessages(client as never, "!room:localhost", {
      limit: CHAT_MESSAGE_INITIAL,
    });
    expect(messages).toHaveLength(CHAT_MESSAGE_INITIAL);
    expect(messages[0]?.body).toBe("msg-40");
    expect(messages.at(-1)?.body).toBe("msg-119");
  });
});
