import { describe, expect, it } from "vitest";
import { CHAT_MESSAGE_BODY_MAX_LENGTH, newChatClientMsgId } from "./client-msg-id";

describe("newChatClientMsgId", () => {
  it("returns a non-empty id", () => {
    const id = newChatClientMsgId();
    expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it("returns unique ids", () => {
    expect(newChatClientMsgId()).not.toBe(newChatClientMsgId());
  });
});

describe("CHAT_MESSAGE_BODY_MAX_LENGTH", () => {
  it("matches server limit", () => {
    expect(CHAT_MESSAGE_BODY_MAX_LENGTH).toBe(4000);
  });
});
