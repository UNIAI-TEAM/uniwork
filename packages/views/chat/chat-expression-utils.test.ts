import { describe, expect, it } from "vitest";
import {
  formatChatMediaMessageBody,
  isChatMediaMessageBody,
  parseChatMediaMessageBody,
  twemojiStickerUrl,
} from "./chat-expression-utils";

describe("chat-expression-utils", () => {
  it("builds twemoji sticker urls", () => {
    expect(twemojiStickerUrl("😀")).toContain("1f600.png");
  });

  it("formats and parses media message bodies", () => {
    const body = formatChatMediaMessageBody("https://cdn.example/sticker.png", "sticker:cười");
    expect(isChatMediaMessageBody(body)).toBe(true);
    expect(parseChatMediaMessageBody(body)).toEqual({
      url: "https://cdn.example/sticker.png",
      alt: "sticker:cười",
    });
  });
});
