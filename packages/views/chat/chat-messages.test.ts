import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_PAGE_SIZE } from "@uniwork/core/chat/room-timeline";
import { CHAT_MESSAGE_INITIAL } from "./chat-messages";

describe("chat message paging constants", () => {
  it("uses a smaller first page than subsequent loads", () => {
    expect(CHAT_MESSAGE_INITIAL).toBeGreaterThan(CHAT_HISTORY_PAGE_SIZE);
  });
});
