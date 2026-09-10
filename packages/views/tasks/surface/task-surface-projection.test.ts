import { describe, expect, it } from "vitest";
import type { Task } from "@uniwork/core/types";
import { projectSurfaceTasks } from "./task-surface-projection";

const base: Task = {
  id: "t1",
  organization_id: "o1",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "Task",
  description: "",
  status: "todo",
  priority: "medium",
  assignee_kind: "human",
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

function task(overrides: Partial<Task>): Task {
  return { ...base, ...overrides } as Task;
}

describe("projectSurfaceTasks", () => {
  it("hides sub-tasks when requested", () => {
    const tasks = [
      task({ id: "parent" }),
      task({ id: "child", parent_task_id: "parent" }),
    ];

    expect(
      projectSurfaceTasks(tasks, {
        showSubTasks: false,
        sortBy: "position",
        sortDirection: "asc",
      }).map((item) => item.id),
    ).toEqual(["parent"]);
  });

  it("sorts the projected tasks", () => {
    const tasks = [
      task({ id: "low", title: "B", priority: "low" }),
      task({ id: "urgent", title: "A", priority: "urgent" }),
    ];

    expect(
      projectSurfaceTasks(tasks, {
        showSubTasks: true,
        sortBy: "title",
        sortDirection: "asc",
      }).map((item) => item.id),
    ).toEqual(["urgent", "low"]);
  });
});
