import { describe, expect, it } from "vitest";
import { groupChatMessages, type MeetingChatItem } from "./meeting-chat";

function item(partial: Partial<MeetingChatItem> & Pick<MeetingChatItem, "id" | "fromIdentity" | "message">): MeetingChatItem {
  return {
    fromName: partial.fromIdentity,
    isLocal: false,
    timestamp: 0,
    ...partial,
  };
}

describe("groupChatMessages", () => {
  it("groups consecutive messages from the same sender", () => {
    const groups = groupChatMessages([
      item({ id: "1", fromIdentity: "a", fromName: "An", message: "hi", timestamp: 1 }),
      item({ id: "2", fromIdentity: "a", fromName: "An", message: "there", timestamp: 2 }),
      item({ id: "3", fromIdentity: "b", fromName: "Bình", message: "ok", timestamp: 3 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((m) => m.message)).toEqual(["hi", "there"]);
    expect(groups[1]?.fromIdentity).toBe("b");
  });

  it("starts a new group when the sender changes back", () => {
    const groups = groupChatMessages([
      item({ id: "1", fromIdentity: "a", message: "1" }),
      item({ id: "2", fromIdentity: "b", message: "2" }),
      item({ id: "3", fromIdentity: "a", message: "3" }),
    ]);
    expect(groups.map((g) => g.fromIdentity)).toEqual(["a", "b", "a"]);
  });
});
