import { describe, expect, it } from "vitest";
import type { MeetingSummaryActionItem } from "../types/meeting";
import {
  buildMeetingSummaryTasksBody,
  buildSummaryTaskItems,
  isConvertedItem,
  previewAssigneeId,
  summaryItemDraft,
} from "./summary-task-items";

const item = (over: Partial<MeetingSummaryActionItem> & { index: number }): MeetingSummaryActionItem => ({
  title: `Việc ${over.index}`,
  ...over,
});

describe("summaryItemDraft", () => {
  it("starts from the server's suggestion, and from none where it has none", () => {
    expect(summaryItemDraft(item({ index: 0, suggested_assignee_id: "u1", due_date: "2026-09-05" }))).toEqual({
      assigneeId: "u1",
      dueDate: "2026-09-05",
      priority: "none",
    });
    expect(summaryItemDraft(item({ index: 1, owner: "Minh", due: "thứ Sáu" }))).toEqual({
      assigneeId: null,
      dueDate: null,
      priority: "none",
    });
  });
});

describe("buildMeetingSummaryTasksBody", () => {
  const items = [
    item({ index: 0, owner: "Minh", due: "thứ Sáu", suggested_assignee_id: "u-minh", due_date: "2026-09-05" }),
    item({ index: 1, task_id: "t-old" }),
    item({ index: 2 }),
  ];

  it("names the summary and each item, and always says who and when, null for none", () => {
    const body = buildMeetingSummaryTasksBody("s1", items, [0, 2], {}, "p1");
    expect(body).toEqual({
      summary_id: "s1",
      items: [
        { index: 0, assignee_id: "u-minh", due_date: "2026-09-05", project_id: "p1" },
        { index: 2, assignee_id: null, due_date: null, project_id: "p1" },
      ],
    });
    // The AI's words are never sent for the server to re-read.
    for (const sent of body!.items) {
      expect(sent).not.toHaveProperty("owner");
      expect(sent).not.toHaveProperty("due_spoken");
    }
  });

  it("keeps the host's explicit none over the suggestion", () => {
    const body = buildMeetingSummaryTasksBody(
      "s1",
      items,
      [0],
      { 0: { assigneeId: null, dueDate: null, priority: "high" } },
      undefined,
    );
    expect(body?.items[0]).toEqual({ index: 0, assignee_id: null, due_date: null, project_id: "", priority: "high" });
  });

  it("skips items that already became tasks and returns null when nothing is left", () => {
    expect(buildMeetingSummaryTasksBody("s1", items, [1], {}, "p1")).toBeNull();
    expect(buildMeetingSummaryTasksBody("s1", items, [], {}, "p1")).toBeNull();
    expect(isConvertedItem(items[1]!)).toBe(true);
    expect(isConvertedItem(items[0]!)).toBe(false);
  });
});

describe("buildSummaryTaskItems (Email Hub)", () => {
  it("maps picked action items with owner and due for the Email Hub request", () => {
    const out = buildSummaryTaskItems(
      [
        { title: "Gửi báo cáo", owner: "An", due: "thứ Sáu" },
        { title: "Review PR" },
      ],
      [0],
      { 0: "user-override" },
    );
    expect(out).toEqual([{ title: "Gửi báo cáo", owner: "An", due_spoken: "thứ Sáu", assignee_id: "user-override" }]);
  });

  it("includes the project and the field overrides", () => {
    const out = buildSummaryTaskItems([{ title: "Ship" }], [0], undefined, "proj-1", {
      0: { priority: "high", due_date: "2026-09-05" },
    });
    expect(out[0]).toMatchObject({ project_id: "proj-1", priority: "high", due_date: "2026-09-05" });
  });
});

describe("previewAssigneeId", () => {
  const members = [
    { user_id: "u-an", display_name: "Nguyễn Văn An" },
    { user_id: "u-thanh", display_name: "Thanh" },
    { user_id: "u-lan-anh", display_name: "Lan Anh" },
    { user_id: "u-b", display_name: "B" },
  ];

  it("matches a whole name or the trailing words of one, never a substring", () => {
    expect(previewAssigneeId("B", members)).toBe("u-b");
    expect(previewAssigneeId("An", members)).toBe("u-an");
    expect(previewAssigneeId("Văn An", members)).toBe("u-an");
    expect(previewAssigneeId("Lan", members)).toBeUndefined();
    expect(previewAssigneeId("han", members)).toBeUndefined();
    expect(previewAssigneeId("Unknown", members)).toBeUndefined();
    expect(previewAssigneeId("", members)).toBeUndefined();
    expect(previewAssigneeId(undefined, members)).toBeUndefined();
  });

  it("folds diacritics in both cases, Đ included, like the server's resolver", () => {
    expect(previewAssigneeId("nguyen van an", members)).toBe("u-an");
    expect(previewAssigneeId("ĐỨC", [{ user_id: "u3", display_name: "Duc" }])).toBe("u3");
    expect(previewAssigneeId("Duc", [{ user_id: "u3", display_name: "Đức" }])).toBe("u3");
  });

  it("drops a leading honorific but keeps a bare one, which is also a name", () => {
    expect(previewAssigneeId("anh An", members)).toBe("u-an");
    expect(previewAssigneeId("chị Thanh", members)).toBe("u-thanh");
    expect(previewAssigneeId("Anh", members)).toBe("u-lan-anh");
  });

  it("stays silent when the name fits more than one person", () => {
    const twins = [
      { user_id: "u1", display_name: "Minh" },
      { user_id: "u2", display_name: "Minh" },
    ];
    expect(previewAssigneeId("Minh", twins)).toBeUndefined();
    expect(previewAssigneeId("An", [...members, { user_id: "u-an2", display_name: "Trần An" }])).toBeUndefined();
  });
});
