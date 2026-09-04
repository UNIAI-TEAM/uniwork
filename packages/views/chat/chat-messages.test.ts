import { describe, expect, it } from "vitest";
import { CHAT_MESSAGE_INITIAL, CHAT_MESSAGE_PAGE_SIZE } from "./chat-messages";

describe("chat message paging constants", () => {
  it("uses a smaller first page than subsequent loads", () => {
    expect(CHAT_MESSAGE_INITIAL).toBeGreaterThan(CHAT_MESSAGE_PAGE_SIZE);
  });
});
