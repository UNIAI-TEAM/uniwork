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
    const body = formatChatMediaMessageBody("https://cdn.example/sticker.png", "sticker:cười");
    expect(isChatMediaMessageBody(body)).toBe(true);
    expect(parseChatMediaMessageBody(body)).toEqual({
      url: "https://cdn.example/sticker.png",
      alt: "sticker:cười",
    });
  });

  it("describes media messages in words instead of markdown", () => {
    const labels = { sticker: "Nhãn dán", gif: "GIF", image: "Hình ảnh" };
    expect(describeChatMediaBody("![sticker:ăn mừng](https://media.giphy.com/a.webp)", labels)).toBe(
      "Nhãn dán · ăn mừng",
    );
    expect(describeChatMediaBody("![gif:vỗ tay](https://media.tenor.com/b.gif)", labels)).toBe("GIF · vỗ tay");
    expect(describeChatMediaBody("![ảnh chụp](https://cdn.example/c.png)", labels)).toBe("Hình ảnh");
    expect(describeChatMediaBody("Chào cả nhà", labels)).toBeNull();
  });
});
