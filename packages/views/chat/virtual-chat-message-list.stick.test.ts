import { afterEach, describe, expect, it, vi } from "vitest";
import { pinChatScrollToBottom, updateStickToBottomFromScroll } from "./virtual-chat-message-list";

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

describe("pinChatScrollToBottom", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not undo a jump made while its follow-up frames are pending", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const stick = { current: true };
    const programmatic = { current: false };
    const el = { scrollTop: 0, scrollHeight: 4000, clientHeight: 500 } as HTMLDivElement;

    pinChatScrollToBottom(el, stick, programmatic, { force: true });
    expect(el.scrollTop).toBe(4000);
    // A jump to a message unpins and scrolls up before the next frame.
    stick.current = false;
    el.scrollTop = 1200;
    while (frames.length) frames.shift()?.(0);
    expect(el.scrollTop).toBe(1200);
    expect(programmatic.current).toBe(false);
  });

  it("keeps pinning through its frames while still pinned", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const stick = { current: true };
    const box = { scrollTop: 0, scrollHeight: 4000, clientHeight: 500 };
    const el = box as HTMLDivElement;
    pinChatScrollToBottom(el, stick, { current: false });
    box.scrollHeight = 4600; // a photo measured after paint
    while (frames.length) frames.shift()?.(0);
    expect(el.scrollTop).toBe(4600);
  });
});
