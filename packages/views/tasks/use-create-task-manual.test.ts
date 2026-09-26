import { describe, expect, it } from "vitest";
import type { CreateTaskDraft } from "@uniwork/core/tasks/stores/create-task-draft-store";
import { draftWithDefaults } from "./use-create-task-manual";

const storedDraft: CreateTaskDraft = {
  title: "Việc đang soạn",
  status: "in_review",
  priority: "urgent",
  dueDate: "2026-09-01",
  assigneeId: "user-1",
  assigneeKind: "human",
  idempotencyKey: "draft-1",
  version: 3,
};

describe("draftWithDefaults", () => {
  it("lets the clicked calendar slot override dates without discarding the draft", () => {
    expect(
      draftWithDefaults(storedDraft, {
        start_date: "2026-09-10",
        due_date: "2026-09-10",
        start_at: "2026-09-10T07:00:00.000Z",
        due_at: "2026-09-10T08:00:00.000Z",
      }),
    ).toEqual({
      ...storedDraft,
      startDate: "2026-09-10",
      dueDate: "2026-09-10",
      startAt: "2026-09-10T07:00:00.000Z",
      dueAt: "2026-09-10T08:00:00.000Z",
    });
  });

  it("applies explicit empty surface defaults", () => {
    expect(
      draftWithDefaults(storedDraft, {
        assignee_id: null,
        project_id: null,
      }),
    ).toMatchObject({
      title: "Việc đang soạn",
      assigneeId: undefined,
      assigneeKind: undefined,
      projectId: undefined,
    });
  });
});
