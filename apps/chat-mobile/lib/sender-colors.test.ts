import { describe, expect, it } from "vitest";
import { senderColorIndex, senderNameClass } from "./sender-colors";

// Parity with packages/views/chat/sender-colors.test.ts: the same id lands on the same slot.
describe("sender-colors", () => {
  it("maps the same id to the same slot, case-insensitively", () => {
    expect(senderColorIndex("@01abc:localhost")).toBe(senderColorIndex("@01ABC:localhost"));
  });

  it("uses one of the eight sender slots", () => {
    expect(senderNameClass("@other:localhost")).toMatch(/^text-chat-sender-[1-8]$/);
  });

  it("matches the web hash for a known id", () => {
    // (hash * 31 + code) >>> 0 over "u1" = 117 * 31 + 49 = 3676 → 3676 % 8 = 4 → slot 5.
    expect(senderColorIndex("u1")).toBe(4);
    expect(senderNameClass("u1")).toBe("text-chat-sender-5");
  });
});
