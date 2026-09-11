import { describe, expect, it } from "vitest";
import { updateStickToBottomFromScroll } from "./virtual-chat-message-list";

describe("updateStickToBottomFromScroll", () => {
  it("keeps stick true on the post-reload scrollTop=0 flash", () => {
    const stick = { current: true };
    const el = {
      scrollTop: 0,
      scrollHeight: 4000,
      clientHeight: 500,
    } as HTMLDivElement;
    expect(updateStickToBottomFromScroll(el, stick)).toBe(true);
    expect(stick.current).toBe(true);
  });

  it("clears stick only after the user scrolls into the middle", () => {
    const stick = { current: true };
    const el = {
      scrollTop: 800,
      scrollHeight: 4000,
      clientHeight: 500,
    } as HTMLDivElement;
    expect(updateStickToBottomFromScroll(el, stick)).toBe(false);
    expect(stick.current).toBe(false);
  });

  it("re-enables stick when the user returns to the bottom", () => {
    const stick = { current: false };
    const el = {
      scrollTop: 3480,
      scrollHeight: 4000,
      clientHeight: 500,
    } as HTMLDivElement;
    expect(updateStickToBottomFromScroll(el, stick)).toBe(true);
    expect(stick.current).toBe(true);
  });
});
