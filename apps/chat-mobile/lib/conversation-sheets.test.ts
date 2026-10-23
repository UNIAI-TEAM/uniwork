import { describe, expect, it } from "vitest";
import { conversationSheetReducer, NO_SHEET, type ConversationSheet } from "./conversation-sheets";
import type { TimelineMessage } from "./timeline-display";

const message: TimelineMessage = { id: "m1", sender: "u2", body: "chào", ts: 0 };

describe("conversationSheetReducer", () => {
  it("opens one sheet at a time: a new one replaces the open one", () => {
    const actions = conversationSheetReducer(NO_SHEET, { type: "open", sheet: { kind: "actions", message } });
    expect(actions).toEqual({ kind: "actions", message });
    expect(conversationSheetReducer(actions, { type: "open", sheet: { kind: "emoji", message } })).toEqual({ kind: "emoji", message });
  });

  it("closes only the sheet that asks, so a late dismissal leaves the next sheet up", () => {
    const emoji: ConversationSheet = { kind: "emoji", message };
    expect(conversationSheetReducer(emoji, { type: "close", kind: "actions" })).toBe(emoji);
    expect(conversationSheetReducer(emoji, { type: "close", kind: "emoji" })).toBe(NO_SHEET);
    expect(conversationSheetReducer(NO_SHEET, { type: "close", kind: "reminder" })).toBe(NO_SHEET);
  });
});
