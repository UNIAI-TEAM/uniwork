import { describe, expect, it } from "vitest";
import type { MeetingActionItem } from "../api/endpoints/meeting-action-items";
import {
  actionItemTaskDefaults,
  buildSummaryTaskItems,
  convertActionItemInput,
  previewAssigneeId,
} from "./summary-task-items";

const item = (over: Partial<MeetingActionItem> & { id: string }): MeetingActionItem => ({
  title: `Việc ${over.id}`,
  status: "PENDING",
  evidence: [],
  ...over,
});

describe("actionItemTaskDefaults", () => {
  it("carries the AI's prose and suggested priority, the description the screen built from them", () => {
    expect(
      actionItemTaskDefaults(
        item({ id: "a2", description: "Gửi báo giá trước thứ Sáu.", suggested_priority: "high" }),
        "p1",
        "Gửi báo giá trước thứ Sáu.\n\n**Căn cứ**",
      ),
    ).toEqual({
      title: "Việc a2",
      description: "Gửi báo giá trước thứ Sáu.\n\n**Căn cứ**",
      priority: "high",
      assignee_id: null,
      due_date: null,
      project_id: "p1",
    });
    // A priority a newer server or a confused model sends is not applied.
    expect(actionItemTaskDefaults(item({ id: "a3", suggested_priority: "critical" }), undefined)).not.toHaveProperty("priority");
    expect(actionItemTaskDefaults(item({ id: "a4", suggested_priority: "none" }), undefined)).not.toHaveProperty("priority");
  });

  it("opens the composer on the item's title and the server's suggestion, none where it has none", () => {
    expect(
      actionItemTaskDefaults(item({ id: "a0", suggested_assignee_id: "u1", suggested_due_date: "2026-09-05" }), "p1"),
    ).toEqual({ title: "Việc a0", assignee_id: "u1", due_date: "2026-09-05", project_id: "p1" });
    // The spoken words stay suggestions: never read into who or when.
    expect(actionItemTaskDefaults(item({ id: "a1", owner_text: "Minh", due_text: "thứ Sáu" }), undefined)).toEqual({
      title: "Việc a1",
      assignee_id: null,
      due_date: null,
      project_id: null,
    });
  });
});

describe("convertActionItemInput", () => {
  it("sends what the composer submitted, with who, when and the project always explicit", () => {
    expect(
      convertActionItemInput("a0", {
        title: "Gửi báo cáo quý",
        description: "Kèm số liệu",
        status: "in_progress",
        priority: "high",
        assignee_id: "agent-1",
        assignee_kind: "agent",
        project_id: null,
        parent_task_id: "t-parent",
        stage: 2,
        start_date: "2026-09-01",
        due_date: null,
        start_at: "2026-09-01T02:00:00Z",
        due_at: "2026-09-01T03:00:00Z",
        label_ids: ["l1"],
        attachment_ids: ["f1"],
        properties: { p1: "x" },
      }),
    ).toEqual({
      action_item_id: "a0",
      title: "Gửi báo cáo quý",
      description: "Kèm số liệu",
      status: "in_progress",
      priority: "high",
      assignee_id: "agent-1",
      assignee_kind: "agent",
      // "" is no project: null would let the server apply the meeting's.
      project_id: "",
      parent_task_id: "t-parent",
      stage: 2,
      start_date: "2026-09-01",
      due_date: null,
      label_ids: ["l1"],
      attachment_ids: ["f1"],
      properties: { p1: "x" },
    });
  });

  it("reads a field the composer left out as none", () => {
    expect(convertActionItemInput("a1", { title: "Đặt phòng" })).toEqual({
      action_item_id: "a1",
      title: "Đặt phòng",
      assignee_id: null,
      due_date: null,
      project_id: "",
    });
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
