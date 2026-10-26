import { describe, expect, it } from "vitest";
import type { MeetingActionItem } from "@uniwork/core/meetings/action-items";
import { demo } from "../test-fixtures";
import { earliestDue, ownerGroups, ownerOf, recipients } from "./owner-groups";

const items = demo.meetings.m1.action_items.items as unknown as MeetingActionItem[];
const { lan, ha, minh } = demo.users;

describe("ownerGroups", () => {
  it("groups M1's 14 items by owner in the order the meeting named them, as the board draws them", () => {
    const groups = ownerGroups(items);
    expect(groups.map((g) => [g.ownerId, g.pending.length, g.converted.length, g.done])).toEqual([
      [minh.id, 5, 2, 0],
      [ha.id, 3, 2, 0],
      [lan.id, 1, 1, 1],
    ]);
  });

  it("reads the suggestion while pending and the task's assignee once converted, and puts nobody last", () => {
    const pending = { id: "p", title: "x", status: "PENDING", evidence: [], suggested_assignee_id: null } as MeetingActionItem;
    const converted = { id: "c", title: "y", status: "CONVERTED", evidence: [], task: { id: "t", assignee_id: "u1" } } as MeetingActionItem;
    const dismissed = { id: "d", title: "z", status: "DISMISSED", evidence: [] } as MeetingActionItem;
    expect(ownerOf(converted)).toBe("u1");
    expect(ownerGroups([pending, converted, dismissed]).map((g) => g.ownerId)).toEqual(["u1", ""]);
  });
});

describe("earliestDue / recipients", () => {
  it("finds the earliest well-formed date and ignores blanks", () => {
    expect(earliestDue(["2026-10-29", null, "2026-10-26", "soon", undefined])).toBe("2026-10-26");
    expect(earliestDue([null, ""])).toBeNull();
  });

  it("counts rows per assignee in first-appearance order", () => {
    expect(recipients(["a", "b", "a", "", "a"])).toEqual([
      { ownerId: "a", count: 3 },
      { ownerId: "b", count: 1 },
      { ownerId: "", count: 1 },
    ]);
  });
});
