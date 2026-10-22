import { describe, expect, it } from "vitest";
import type { AiConversation } from "@uniwork/core/types";
import { formatConversationTime, groupConversations } from "./ask-uni-history-groups";

const now = new Date(2026, 9, 21, 10, 0);
const conv = (id: string, d: Date): AiConversation =>
  ({ id, title: id, created_at: d.toISOString(), updated_at: d.toISOString() }) as AiConversation;

describe("groupConversations", () => {
  it("groups by local day and drops empty groups", () => {
    const groups = groupConversations(
      [
        conv("a", new Date(2026, 9, 21, 9, 0)),
        conv("b", new Date(2026, 9, 20, 23, 0)),
        conv("c", new Date(2026, 9, 16, 12, 0)),
        conv("d", new Date(2026, 9, 1, 12, 0)),
        conv("e", new Date(2026, 9, 21, 8, 0)),
      ],
      now,
    );
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ["today", ["a", "e"]],
      ["yesterday", ["b"]],
      ["week", ["c"]],
      ["older", ["d"]],
    ]);
    expect(groupConversations([conv("a", new Date(2026, 9, 21, 9, 0))], now)).toHaveLength(1);
  });
});

describe("formatConversationTime", () => {
  it("formats today, this week and older", () => {
    expect(formatConversationTime(new Date(2026, 9, 21, 9, 5).toISOString(), now, "vi")).toBe("09:05");
    expect(formatConversationTime(new Date(2026, 9, 16, 9, 5).toISOString(), now, "vi")).toBe(
      new Intl.DateTimeFormat("vi", { weekday: "short" }).format(new Date(2026, 9, 16, 9, 5)),
    );
    expect(formatConversationTime(new Date(2026, 9, 1, 9, 5).toISOString(), now, "vi")).toBe("01/10");
  });
  it("returns an empty string for an invalid date", () => {
    expect(formatConversationTime("nope", now, "vi")).toBe("");
  });
});
