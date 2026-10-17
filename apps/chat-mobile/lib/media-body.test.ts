// Parity: packages/views/chat/chat-expression-utils.test.ts (the phone shows
// stickers and GIFs, and from M3 sends them).
import { describe, expect, it } from "vitest";
import { describeChatMediaBody, formatChatMediaMessageBody, parseChatMediaMessageBody } from "./media-body";

const twemoji = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f600.png";

describe("media-body", () => {
  it("formats a sticker body the parser reads back", () => {
    const body = formatChatMediaMessageBody("https://media.giphy.com/sticker.png", "sticker:cười");
    expect(parseChatMediaMessageBody(body)).toEqual({ url: "https://media.giphy.com/sticker.png", alt: "sticker:cười" });
    // Brackets would end the alt early; an empty one still names the media.
    expect(formatChatMediaMessageBody("https://media.tenor.com/a.gif", "gif:[x]")).toBe("![gif:x](https://media.tenor.com/a.gif)");
    expect(formatChatMediaMessageBody("https://media.tenor.com/a.gif", " [] ")).toBe("![media](https://media.tenor.com/a.gif)");
  });

  it("parses media message bodies", () => {
    expect(parseChatMediaMessageBody("![sticker:cười](https://media.giphy.com/sticker.png)")).toEqual({
      url: "https://media.giphy.com/sticker.png",
      alt: "sticker:cười",
    });
    expect(parseChatMediaMessageBody("![](https://media.tenor.com/a.gif)")).toEqual({
      url: "https://media.tenor.com/a.gif",
      alt: "media",
    });
  });

  it("describes media messages in words instead of markdown", () => {
    const labels = { sticker: "Nhãn dán", gif: "GIF", image: "Hình ảnh" };
    expect(describeChatMediaBody("![sticker:ăn mừng](https://media.giphy.com/a.webp)", labels)).toBe(
      "Nhãn dán · ăn mừng",
    );
    expect(describeChatMediaBody("![sticker](https://media.giphy.com/a.webp)", labels)).toBe("Nhãn dán");
    expect(describeChatMediaBody("![gif:vỗ tay](https://media.tenor.com/b.gif)", labels)).toBe("GIF · vỗ tay");
    expect(describeChatMediaBody("![gif](https://media.tenor.com/b.webp)", labels)).toBe("GIF");
    expect(describeChatMediaBody("![ảnh chụp](https://media.tenor.com/c.png)", labels)).toBe("Hình ảnh");
    expect(describeChatMediaBody("Chào cả nhà", labels)).toBeNull();
  });

  it("refuses media from hosts outside the allowlist", () => {
    for (const url of [
      "https://evil.example/p.gif",
      "http://media.tenor.com/a.gif",
      "https://media.tenor.com@evil.example/a.gif",
      "https://media.tenor.com.evil.example/a.gif",
      "https://%%/a.gif",
    ]) {
      expect(parseChatMediaMessageBody(`![gif:hi](${url})`)).toBeNull();
    }
    for (const url of ["https://media.tenor.com/a.gif", "https://media.giphy.com/media/x/giphy.gif", twemoji]) {
      expect(parseChatMediaMessageBody(`![gif:hi](${url})`)).toEqual({ url, alt: "gif:hi" });
    }
  });
});
