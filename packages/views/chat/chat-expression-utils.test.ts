import { describe, expect, it } from "vitest";
import {
  describeChatMediaBody,
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
    const body = formatChatMediaMessageBody("https://media.giphy.com/sticker.png", "sticker:cười");
    expect(isChatMediaMessageBody(body)).toBe(true);
    expect(parseChatMediaMessageBody(body)).toEqual({
      url: "https://media.giphy.com/sticker.png",
      alt: "sticker:cười",
    });
  });

  it("describes media messages in words instead of markdown", () => {
    const labels = { sticker: "Nhãn dán", gif: "GIF", image: "Hình ảnh" };
    expect(describeChatMediaBody("![sticker:ăn mừng](https://media.giphy.com/a.webp)", labels)).toBe(
      "Nhãn dán · ăn mừng",
    );
    expect(describeChatMediaBody("![gif:vỗ tay](https://media.tenor.com/b.gif)", labels)).toBe("GIF · vỗ tay");
    expect(describeChatMediaBody("![ảnh chụp](https://media.tenor.com/c.png)", labels)).toBe("Hình ảnh");
    expect(describeChatMediaBody("Chào cả nhà", labels)).toBeNull();
  });

  it("refuses media from hosts outside the allowlist", () => {
    for (const url of [
      "https://evil.example/p.gif",
      "http://media.tenor.com/a.gif",
      "https://media.tenor.com@evil.example/a.gif",
      "https://media.tenor.com.evil.example/a.gif",
    ]) {
      expect(parseChatMediaMessageBody(`![gif:hi](${url})`)).toBeNull();
      expect(isChatMediaMessageBody(`![gif:hi](${url})`)).toBe(false);
    }
    for (const url of [
      "https://media.tenor.com/a.gif",
      "https://media.giphy.com/media/x/giphy.gif",
      twemojiStickerUrl("😀"),
    ]) {
      expect(parseChatMediaMessageBody(`![gif:hi](${url})`)).toEqual({ url, alt: "gif:hi" });
    }
  });
});
