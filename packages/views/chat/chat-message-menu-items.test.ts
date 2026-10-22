import { describe, expect, it } from "vitest";
import { CHAT_MESSAGE_MENU_CLASS } from "./chat-message-menu-items";

describe("CHAT_MESSAGE_MENU_CLASS (UNI-2012 V1-F8)", () => {
  it("never outgrows the viewport and scrolls inside", () => {
    expect(CHAT_MESSAGE_MENU_CLASS).toContain("max-h-[min(var(--available-height),calc(100dvh-1rem))]");
  });

  it("tightens item and sub-trigger rows on a short viewport so a document card's tall menu fits", () => {
    expect(CHAT_MESSAGE_MENU_CLASS).toContain("[@media(max-height:960px)]:[&>[data-slot$=menu-item]]:min-h-8");
    expect(CHAT_MESSAGE_MENU_CLASS).toContain("[@media(max-height:960px)]:[&>[data-slot$=menu-sub-trigger]]:min-h-8");
  });
});
