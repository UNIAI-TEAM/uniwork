import { ChatRoomSchema, type ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { bubbleCorners, continuedRunKeys, roomHeaderMark } from "./conversation-display";
import { buildTimelineRows, type TimelineMessage } from "./timeline-display";

const corners = (own: boolean, first: boolean, last: boolean) => {
  const c = bubbleCorners(own, first, last);
  return [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius];
};

describe("bubbleCorners", () => {
  it("rounds a lone bubble with a tail on the sender's side", () => {
    expect(corners(false, true, true)).toEqual([18, 18, 18, 4]);
    expect(corners(true, true, true)).toEqual([18, 18, 4, 18]);
  });

  it("joins the bubbles of a run on the sender's side", () => {
    expect(corners(false, true, false)).toEqual([18, 18, 18, 6]);
    expect(corners(false, false, false)).toEqual([6, 18, 18, 6]);
    expect(corners(false, false, true)).toEqual([6, 18, 18, 4]);
    expect(corners(true, true, false)).toEqual([18, 18, 6, 18]);
    expect(corners(true, false, false)).toEqual([18, 6, 6, 18]);
    expect(corners(true, false, true)).toEqual([18, 6, 4, 18]);
  });
});

describe("continuedRunKeys", () => {
  const at = (id: string, sender: string, minutes: number, kind?: string): TimelineMessage => ({
    id,
    sender,
    body: id,
    kind,
    ts: new Date(2026, 9, 18, 9, minutes).getTime(),
  });

  it("marks a bubble the same sender's next bubble follows, not the run's last one", () => {
    const rows = buildTimelineRows([at("a1", "a", 0), at("a2", "a", 1), at("a3", "a", 2), at("b1", "b", 3), at("b2", "b", 30)]);
    expect([...continuedRunKeys(rows)]).toEqual(["a1", "a2"]);
  });

  it("ends a run at a card or a new day", () => {
    const nextDay = { ...at("a3", "a", 0), ts: new Date(2026, 9, 19, 9, 0).getTime() };
    const rows = buildTimelineRows([at("a1", "a", 0), at("p1", "a", 1, "poll"), at("a2", "a", 2), nextDay]);
    expect(continuedRunKeys(rows).size).toBe(0);
  });
});

describe("roomHeaderMark", () => {
  const room = (raw: Record<string, unknown>): ChatRoomRecord => ChatRoomSchema.parse({ id: "r", workspace_id: "w1", name: "", member_count: 0, ...raw });

  it("draws the room's kind, or the person with presence in a DM", () => {
    expect(roomHeaderMark(room({ kind: "workspace" }), "Acme", false)).toEqual({ kind: "workspace" });
    expect(roomHeaderMark(room({ kind: "channel", is_default: true }), "Acme", false)).toEqual({ kind: "workspace" });
    expect(roomHeaderMark(room({ kind: "channel" }), "#dev", false)).toEqual({ kind: "channel" });
    expect(roomHeaderMark(room({ kind: "channel", visibility: "private" }), "sales", false)).toEqual({ kind: "private-channel" });
    expect(roomHeaderMark(room({ kind: "group" }), "Thiết kế", false)).toEqual({ kind: "group" });
    expect(roomHeaderMark(room({ kind: "dm" }), "Bình", true)).toEqual({ kind: "dm", label: "Bình", online: true });
  });
});
