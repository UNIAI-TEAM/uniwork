import { describe, expect, it } from "vitest";
import type { Task } from "@uniwork/core/types";
import { projectSurfaceTasks, sortSurfaceTasks } from "./task-surface-projection";

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

const emptyClientFilters = {
  statusFilters: [] as string[],
  priorityFilters: [] as import("@uniwork/core/types").TaskPriority[],
  assigneeFilters: [] as import("@uniwork/core/tasks/stores/view-store-types").ActorFilterValue[],
  includeNoAssignee: false,
  creatorFilters: [] as import("@uniwork/core/tasks/stores/view-store-types").ActorFilterValue[],
  projectFilters: [] as string[],
  includeNoProject: false,
  labelFilters: [] as string[],
  workingOnly: false,
};

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

  it("applies client status filter on load-flat projection", () => {
    const tasks = [
      task({ id: "todo", status: "todo" }),
      task({ id: "done", status: "done" }),
    ];

    expect(
      projectSurfaceTasks(tasks, {
        showSubTasks: true,
        sortBy: "position",
        sortDirection: "asc",
        taskFilters: {
          ...emptyClientFilters,
          statusFilters: ["todo"],
        },
      }).map((item) => item.id),
    ).toEqual(["todo"]);
  });

  it("applies only workingOnly when clientOnlyFilterDimensions is set", () => {
    const tasks = [
      task({ id: "todo", status: "todo" }),
      task({ id: "done", status: "done" }),
    ];

    expect(
      projectSurfaceTasks(tasks, {
        showSubTasks: true,
        sortBy: "position",
        sortDirection: "asc",
        clientOnlyFilterDimensions: true,
        taskFilters: {
          ...emptyClientFilters,
          statusFilters: ["todo"],
          workingOnly: true,
        },
        filterContext: { runningTaskIds: new Set(["done"]) },
      }).map((item) => item.id),
    ).toEqual(["done"]);
  });
});

describe("sortSurfaceTasks", () => {
  it("sorts loaded tasks by title status priority and due date", () => {
    const rows = [
      task({
        id: "b",
        title: "Bravo",
        status: "done",
        priority: "low",
        due_date: "2026-09-10",
      }),
      task({
        id: "a",
        title: "Alpha",
        status: "todo",
        priority: "high",
        due_date: "2026-09-01",
      }),
    ];
    expect(sortSurfaceTasks(rows, "title", "asc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortSurfaceTasks(rows, "title", "desc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    // Catalog order: done after todo; low before high.
    expect(sortSurfaceTasks(rows, "status", "asc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortSurfaceTasks(rows, "priority", "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    expect(sortSurfaceTasks(rows, "due_date", "asc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortSurfaceTasks(rows, "position", "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("sorts by created/updated/start and keeps unknown fields stable", () => {
    const rows = [
      task({
        id: "b",
        title: "B",
        created_at: "2026-09-02T00:00:00Z",
        updated_at: "2026-09-04T00:00:00Z",
        start_date: "2026-09-10",
      }),
      task({
        id: "a",
        title: "A",
        created_at: "2026-09-01T00:00:00Z",
        updated_at: "2026-09-05T00:00:00Z",
        start_date: undefined,
      }),
    ];
    expect(sortSurfaceTasks(rows, "created_at", "asc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortSurfaceTasks(rows, "updated_at", "desc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortSurfaceTasks(rows, "start_date", "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    expect(
      sortSurfaceTasks(rows, "property:x" as never, "asc").map((r) => r.id),
    ).toEqual(["b", "a"]);
  });
});
