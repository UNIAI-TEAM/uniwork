import { describe, expect, it } from "vitest";
import type { MeetingActionItem } from "../api/endpoints/meeting-action-items";
import {
  buildConvertActionItemsBody,
  buildSummaryTaskItems,
  previewAssigneeId,
  summaryItemDraft,
} from "./summary-task-items";

const item = (over: Partial<MeetingActionItem> & { id: string }): MeetingActionItem => ({
  title: `Việc ${over.id}`,
  status: "PENDING",
  ...over,
});

describe("summaryItemDraft", () => {
  it("starts from the server's suggestion, and from none where it has none", () => {
    expect(summaryItemDraft(item({ id: "a0", suggested_assignee_id: "u1", suggested_due_date: "2026-09-05" }))).toEqual({
      assigneeId: "u1",
      dueDate: "2026-09-05",
      priority: "none",
    });
    expect(summaryItemDraft(item({ id: "a1", owner_text: "Minh", due_text: "thứ Sáu" }))).toEqual({
      assigneeId: null,
      dueDate: null,
      priority: "none",
    });
  });
});

describe("buildConvertActionItemsBody", () => {
  const items = [
    item({ id: "a0", owner_text: "Minh", due_text: "thứ Sáu", suggested_assignee_id: "u-minh", suggested_due_date: "2026-09-05" }),
    item({ id: "a1", status: "CONVERTED", task: { id: "t-old" } }),
    item({ id: "a2" }),
    item({ id: "a3", status: "DISMISSED" }),
  ];

  it("names each item and always says who and when, null for none", () => {
    const body = buildConvertActionItemsBody(items, new Set(["a0", "a2"]), {}, "p1");
    expect(body).toEqual({
      items: [
        { action_item_id: "a0", assignee_id: "u-minh", due_date: "2026-09-05", project_id: "p1" },
        { action_item_id: "a2", assignee_id: null, due_date: null, project_id: "p1" },
      ],
    });
    // The spoken words are never sent for the server to re-read.
    for (const sent of body!.items) {
      expect(sent).not.toHaveProperty("owner_text");
      expect(sent).not.toHaveProperty("due_text");
    }
  });

  it("keeps the clerk's explicit none and an edited title over the suggestion", () => {
    const body = buildConvertActionItemsBody(
      items,
      new Set(["a0"]),
      { a0: { assigneeId: null, dueDate: null, priority: "high", title: " Gửi báo cáo quý " } },
      undefined,
    );
    expect(body?.items[0]).toEqual({
      action_item_id: "a0",
      title: "Gửi báo cáo quý",
      assignee_id: null,
      due_date: null,
      project_id: "",
      priority: "high",
    });
  });

  it("skips items that are not pending and returns null when nothing is left", () => {
    expect(buildConvertActionItemsBody(items, new Set(["a1", "a3"]), {}, "p1")).toBeNull();
    expect(buildConvertActionItemsBody(items, new Set(), {}, "p1")).toBeNull();
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
