import { describe, expect, it } from "vitest";
import { buildSummaryTaskItems, previewAssigneeId } from "./summary-task-items";

describe("buildSummaryTaskItems", () => {
  it("maps picked action items with owner and due for server resolution", () => {
    const items = buildSummaryTaskItems(
      [
        { title: "Gửi báo cáo", owner: "An", due: "thứ Sáu" },
        { title: "Review PR" },
      ],
      [0],
      { 0: "user-override" },
    );
    expect(items).toEqual([
      {
        title: "Gửi báo cáo",
        owner: "An",
        due_spoken: "thứ Sáu",
        assignee_id: "user-override",
      },
    ]);
  });
});

describe("previewAssigneeId", () => {
  const members = [
    { user_id: "u1", display_name: "An Nguyễn" },
    { user_id: "u2", display_name: "B" },
  ];

  it("returns exact and single fuzzy matches", () => {
    expect(previewAssigneeId("B", members)).toBe("u2");
    expect(previewAssigneeId("An", members)).toBe("u1");
    expect(previewAssigneeId("Unknown", members)).toBeUndefined();
  });
});
