import { describe, expect, it } from "vitest";
import {
  isPendingChatMessageId,
  parsePendingChatMessageId,
  pendingChatMessageId,
} from "./pending-message-id";

describe("pending-message-id", () => {
  it("round-trips a client id through the pending prefix", () => {
    const pending = pendingChatMessageId("abc-123");
    expect(parsePendingChatMessageId(pending)).toBe("abc-123");
  });

  it("returns null when parsing a non-prefixed id", () => {
    expect(parsePendingChatMessageId("regular-id")).toBeNull();
  });

  it("returns null when parsing a bare prefix with empty client id", () => {
    expect(parsePendingChatMessageId(pendingChatMessageId(""))).toBeNull();
  });

  it("detects pending ids", () => {
    expect(isPendingChatMessageId(pendingChatMessageId("x"))).toBe(true);
    expect(isPendingChatMessageId("plain-id")).toBe(false);
  });
});
