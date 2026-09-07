import { describe, expect, it } from "vitest";
import { bulletinRemindersToChatMessages, mergeChatMessagesWithReminders } from "./chat-reminder-messages";
import type { ChatMessage } from "./chat-messages";

describe("chat-reminder-messages", () => {
  it("maps bulletin reminders to chat messages", () => {
    const messages = bulletinRemindersToChatMessages(
      [
        {
          id: "r1",
          body: "Họp team",
          remindAt: "2026-09-05T09:00:00.000Z",
          repeat: "none",
          createdAt: "2026-09-04T10:00:00.000Z",
          createdBy: "USER1",
        },
      ],
      "USER2",
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.kind).toBe("reminder");
    expect(messages[0]?.sender).toBe("USER1");
    expect(messages[0]?.reminder?.body).toBe("Họp team");
  });

  it("merges reminders into the timeline", () => {
    const base: ChatMessage[] = [
      {
        id: "m1",
        sender: "USER1",
        body: "hello",
        ts: 100,
        reactions: {},
      },
    ];
    const merged = mergeChatMessagesWithReminders(
      base,
      [
        {
          id: "r1",
          body: "Nhắc",
          remindAt: "2026-09-05T09:00:00.000Z",
          repeat: "daily",
          createdAt: "2026-09-04T11:00:00.000Z",
        },
      ],
      "USER1",
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.id)).toEqual(["m1", "r1"]);
  });
});
