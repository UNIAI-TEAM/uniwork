import { describe, expect, it } from "vitest";
import type { ChatMessageLinkRecord } from "../api/endpoints/chat-links";
import {
  attachLinksToMessage,
  attachLinksToMessages,
  EMPTY_CHAT_TASK_TITLE,
  groupLinksByMessageId,
  taskLinksOf,
  titleFromMessageBody,
} from "./message-links";

const link = (
  partial: Partial<ChatMessageLinkRecord> & Pick<ChatMessageLinkRecord, "id" | "message_id" | "target_id">,
): ChatMessageLinkRecord => ({
  target_type: "task",
  relation: "mentions",
  created_by: "u1",
  created_at: "2026-09-10T10:00:00Z",
  ...partial,
});

describe("titleFromMessageBody", () => {
  it("returns the default title for empty body", () => {
    expect(titleFromMessageBody("")).toBe(EMPTY_CHAT_TASK_TITLE);
    expect(titleFromMessageBody("   ")).toBe(EMPTY_CHAT_TASK_TITLE);
  });

  it("keeps short bodies intact", () => {
    expect(titleFromMessageBody("Sửa bug login")).toBe("Sửa bug login");
  });

  it("cuts at a word boundary after 40 chars when over 120", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    expect(words.length).toBeGreaterThan(120);
    const title = titleFromMessageBody(words);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith(" ")).toBe(false);
    expect(words.startsWith(title)).toBe(true);
  });

  it("handles emoji and a single long token", () => {
    expect(titleFromMessageBody("🚀 ship it")).toBe("🚀 ship it");
    const long = "a".repeat(200);
    expect(titleFromMessageBody(long)).toHaveLength(120);
  });
});

describe("message link helpers", () => {
  it("filters task links", () => {
    const links = [
      link({ id: "l1", message_id: "m1", target_id: "t1" }),
      link({ id: "l2", message_id: "m1", target_id: "d1", target_type: "document" }),
    ];
    expect(taskLinksOf(links).map((l) => l.id)).toEqual(["l1"]);
  });

  it("attaches matching links onto a message", () => {
    const links = [
      link({ id: "l1", message_id: "m1", target_id: "t1" }),
      link({ id: "l2", message_id: "m2", target_id: "t2" }),
    ];
    expect(attachLinksToMessage({ id: "m1", body: "hi" }, links).links).toHaveLength(1);
  });

  it("attaches links by message id map", () => {
    const grouped = groupLinksByMessageId([
      link({ id: "l1", message_id: "m1", target_id: "t1" }),
      link({ id: "l2", message_id: "m1", target_id: "t2" }),
    ]);
    const rows = attachLinksToMessages([{ id: "m1" }, { id: "m2" }], grouped);
    expect(rows[0]?.links).toHaveLength(2);
    expect(rows[1]?.links).toEqual([]);
  });
});
