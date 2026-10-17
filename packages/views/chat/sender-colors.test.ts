import { describe, expect, it } from "vitest";
import { senderColorIndex, senderNameClass, senderQuoteClass } from "./sender-colors";

describe("sender-colors", () => {
  it("maps the same matrix id to the same slot", () => {
    expect(senderColorIndex("@01abc:localhost")).toBe(senderColorIndex("@01ABC:localhost"));
  });

  it("uses brand colour for own messages", () => {
    expect(senderNameClass("@me:localhost", true)).toBe("text-brand");
  });

  it("uses a sender slot for other messages", () => {
    expect(senderNameClass("@other:localhost", false)).toMatch(/^text-chat-sender-/);
  });

  it("draws a reply quote in the same slot as the sender's name", () => {
    const slot = senderNameClass("@other:localhost", false).replace("text-", "");
    expect(senderQuoteClass("@other:localhost")).toBe(`border-${slot} bg-${slot}/8`);
  });
});
