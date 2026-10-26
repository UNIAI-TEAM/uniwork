import { describe, expect, it } from "vitest";
import { REPLY_SWIPE, replyOffset, shouldReply } from "./reply-swipe";

describe("reply swipe", () => {
  it("follows a rightward drag at half the finger's speed, up to the threshold and never left of rest", () => {
    expect(replyOffset(-40)).toBe(0);
    expect(replyOffset(40)).toBe(20);
    expect(replyOffset(REPLY_SWIPE * 2)).toBe(REPLY_SWIPE);
    expect(replyOffset(400)).toBe(REPLY_SWIPE);
  });

  it("replies once the bubble reached the threshold, not before", () => {
    expect(shouldReply(REPLY_SWIPE - 1)).toBe(false);
    expect(shouldReply(REPLY_SWIPE)).toBe(true);
  });
});
