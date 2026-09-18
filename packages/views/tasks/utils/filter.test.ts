// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  applyTaskFilters,
  filterTasks,
  NO_PROPERTY_VALUE,
  type TaskFilters,
} from "./filter";
import type { Task } from "@uniwork/core/types";

const NO_FILTER: TaskFilters = {
  statusFilters: [],
  priorityFilters: [],
  assigneeFilters: [],
  includeNoAssignee: false,
  creatorFilters: [],
  projectFilters: [],
  includeNoProject: false,
  labelFilters: [],
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    organization_id: "org-1",
    workspace_id: "ws-1",
    number: 1,
    identifier: "UW-1",
    revision: 1,
    title: "Test",
    description: "",
    status: "todo",
    priority: "medium",
    assignee_id: undefined,
    assignee_kind: "human",
    project_id: null,
    parent_task_id: null,
    position: 0,
    kind: "normal",
    created_by: "u-1",
    created_by_kind: "human",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    properties: {},
    reactions: [],
    ...overrides,
  } as Task;
}

const tasks: Task[] = [
  makeTask({
    id: "1",
    status: "todo",
    priority: "high",
    assignee_id: "u-1",
    assignee_kind: "human",
    created_by: "u-1",
    created_by_kind: "human",
    project_id: "p-1",
  }),
  makeTask({
    id: "2",
    status: "in_progress",
    priority: "medium",
    assignee_id: "a-1",
    assignee_kind: "agent",
    created_by: "a-1",
    created_by_kind: "agent",
    project_id: "p-2",
  }),
  makeTask({
    id: "3",
    status: "done",
    priority: "low",
    assignee_id: undefined,
    assignee_kind: "human",
    created_by: "u-2",
    created_by_kind: "human",
    project_id: null,
  }),
  makeTask({
    id: "4",
    status: "todo",
    priority: "urgent",
    assignee_id: "u-2",
    assignee_kind: "human",
    created_by: "u-1",
    created_by_kind: "human",
    project_id: "p-1",
  }),
];

function labelsByTaskIdFrom(
  entries: Array<{ taskId: string; labels: readonly { id: string }[] }>,
): ReadonlyMap<string, readonly { id: string }[]> {
  return new Map(entries.map((e) => [e.taskId, e.labels]));
}

describe("filterTasks", () => {
  it("returns all tasks when no filters are active", () => {
    expect(filterTasks(tasks, NO_FILTER)).toHaveLength(4);
  });

  it("filters by status", () => {
    const result = filterTasks(tasks, { ...NO_FILTER, statusFilters: ["todo"] });
    expect(result.map((t) => t.id)).toEqual(["1", "4"]);
  });

  it("maps member actor filter onto human assignee_kind", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      assigneeFilters: [{ type: "member", id: "u-1" }],
    });
    expect(result.map((t) => t.id)).toEqual(["1"]);
  });

  it("filters by priority", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      priorityFilters: ["high", "urgent"],
    });
    expect(result.map((t) => t.id)).toEqual(["1", "4"]);
  });

  it("filters by specific assignee", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      assigneeFilters: [{ type: "member", id: "u-1" }],
    });
    expect(result.map((t) => t.id)).toEqual(["1"]);
  });

  it("filters by 'No assignee' only", () => {
    const result = filterTasks(tasks, { ...NO_FILTER, includeNoAssignee: true });
    expect(result.map((t) => t.id)).toEqual(["3"]);
  });

  it("filters by assignee + No assignee combined", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      assigneeFilters: [{ type: "agent", id: "a-1" }],
      includeNoAssignee: true,
    });
    expect(result.map((t) => t.id)).toEqual(["2", "3"]);
  });

  it("treats an explicitly active empty assignee predicate as match-none", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      assigneeFilterActive: true,
    });
    expect(result).toEqual([]);
  });

  it("hides assigned tasks when only 'No assignee' is selected", () => {
    const result = filterTasks(tasks, { ...NO_FILTER, includeNoAssignee: true });
    expect(result.every((t) => !t.assignee_id)).toBe(true);
  });

  it("filters by creator", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      creatorFilters: [{ type: "agent", id: "a-1" }],
    });
    expect(result.map((t) => t.id)).toEqual(["2"]);
  });

  it("applies status + assignee filters together", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      statusFilters: ["todo"],
      assigneeFilters: [{ type: "member", id: "u-1" }],
    });
    expect(result.map((t) => t.id)).toEqual(["1"]);
  });

  it("applies status + priority + creator filters together", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      statusFilters: ["todo"],
      priorityFilters: ["urgent"],
      creatorFilters: [{ type: "member", id: "u-1" }],
    });
    expect(result.map((t) => t.id)).toEqual(["4"]);
  });

  it("filters by specific project", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      projectFilters: ["p-1"],
    });
    expect(result.map((t) => t.id)).toEqual(["1", "4"]);
  });

  it("filters by multiple projects", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      projectFilters: ["p-1", "p-2"],
    });
    expect(result.map((t) => t.id)).toEqual(["1", "2", "4"]);
  });

  it("filters by 'No project' only", () => {
    const result = filterTasks(tasks, { ...NO_FILTER, includeNoProject: true });
    expect(result.map((t) => t.id)).toEqual(["3"]);
  });

  it("filters by project + No project combined", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      projectFilters: ["p-2"],
      includeNoProject: true,
    });
    expect(result.map((t) => t.id)).toEqual(["2", "3"]);
  });

  it("hides project tasks when only 'No project' is selected", () => {
    const result = filterTasks(tasks, { ...NO_FILTER, includeNoProject: true });
    expect(result.every((t) => !t.project_id)).toBe(true);
  });

  it("applies status + project filters together", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      statusFilters: ["todo"],
      projectFilters: ["p-1"],
    });
    expect(result.map((t) => t.id)).toEqual(["1", "4"]);
  });

  const labelBug = { id: "lab-bug" };
  const labelFeat = { id: "lab-feat" };
  const labelP0 = { id: "lab-p0" };
  const labeledTasks: Task[] = [
    makeTask({ id: "L1" }),
    makeTask({ id: "L2" }),
    makeTask({ id: "L3" }),
    makeTask({ id: "L4" }),
    makeTask({ id: "L5" }),
  ];
  const labeledContext = {
    labelsByTaskId: labelsByTaskIdFrom([
      { taskId: "L1", labels: [labelBug] },
      { taskId: "L2", labels: [labelFeat] },
      { taskId: "L3", labels: [labelBug, labelP0] },
      { taskId: "L4", labels: [] },
    ]),
  };

  it("filters by a single label", () => {
    const result = applyTaskFilters(
      labeledTasks,
      { ...NO_FILTER, labelFilters: ["lab-bug"], workingOnly: false },
      labeledContext,
    );
    expect(result.map((t) => t.id)).toEqual(["L1", "L3"]);
  });

  it("filters by multiple labels with OR semantics", () => {
    const result = applyTaskFilters(
      labeledTasks,
      { ...NO_FILTER, labelFilters: ["lab-bug", "lab-feat"], workingOnly: false },
      labeledContext,
    );
    expect(result.map((t) => t.id)).toEqual(["L1", "L2", "L3"]);
  });

  it("excludes tasks with no labels when a label filter is active", () => {
    const result = applyTaskFilters(
      labeledTasks,
      { ...NO_FILTER, labelFilters: ["lab-bug"], workingOnly: false },
      labeledContext,
    );
    expect(result.map((t) => t.id)).not.toContain("L4");
    expect(result.map((t) => t.id)).not.toContain("L5");
  });

  it("fail-closed on labelFilters without labelsByTaskId", () => {
    const single = [makeTask({ id: "1" })];
    expect(
      applyTaskFilters(
        single,
        {
          ...NO_FILTER,
          labelFilters: ["l1"],
          workingOnly: false,
        },
        {},
      ),
    ).toEqual([]);
  });

  it("keeps only running tasks when agentRunningFilter is on", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      agentRunningFilter: true,
      runningTaskIds: new Set(["2", "4"]),
    });
    expect(result.map((t) => t.id)).toEqual(["2", "4"]);
  });

  it("hides everything when agentRunningFilter is on but no ids running", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      agentRunningFilter: true,
      runningTaskIds: new Set(),
    });
    expect(result).toHaveLength(0);
  });

  it("ignores runningTaskIds when agentRunningFilter is off", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      runningTaskIds: new Set(["2"]),
    });
    expect(result).toHaveLength(4);
  });

  it("composes agentRunningFilter with other filters (AND semantics)", () => {
    const result = filterTasks(tasks, {
      ...NO_FILTER,
      statusFilters: ["todo"],
      agentRunningFilter: true,
      runningTaskIds: new Set(["1", "2"]),
    });
    expect(result.map((t) => t.id)).toEqual(["1"]);
  });

  it("applies workingOnly from runningTaskIds context", () => {
    const result = applyTaskFilters(
      tasks,
      {
        ...NO_FILTER,
        workingOnly: true,
      },
      {
        runningTaskIds: new Set(["1"]),
      },
    );
    expect(result.map((t) => t.id)).toEqual(["1"]);
  });

  const parentChildTasks: Task[] = [
    makeTask({ id: "P1", parent_task_id: null }),
    makeTask({ id: "C1", parent_task_id: "P1" }),
    makeTask({ id: "P2", parent_task_id: null }),
    makeTask({ id: "C2", parent_task_id: "P2" }),
  ];

  it("hides sub-tasks when showSubTasks is false", () => {
    const result = filterTasks(parentChildTasks, {
      ...NO_FILTER,
      showSubTasks: false,
    });
    expect(result.map((t) => t.id)).toEqual(["P1", "P2"]);
  });

  it("keeps sub-tasks when showSubTasks is true or omitted", () => {
    expect(
      filterTasks(parentChildTasks, { ...NO_FILTER, showSubTasks: true }),
    ).toHaveLength(4);
    expect(filterTasks(parentChildTasks, NO_FILTER)).toHaveLength(4);
  });

  it("composes showSubTasks with other filters (AND semantics)", () => {
    const mixed: Task[] = [
      makeTask({ id: "P", status: "todo", parent_task_id: null }),
      makeTask({ id: "C", status: "todo", parent_task_id: "P" }),
      makeTask({ id: "PD", status: "done", parent_task_id: null }),
    ];
    const result = filterTasks(mixed, {
      ...NO_FILTER,
      statusFilters: ["todo"],
      showSubTasks: false,
    });
    expect(result.map((t) => t.id)).toEqual(["P"]);
  });

  it("matches NO_PROPERTY_VALUE when property unset", () => {
    const local = [
      makeTask({ id: "1", properties: {} }),
      makeTask({ id: "2", properties: { p1: "opt-a" } }),
    ];
    expect(
      filterTasks(local, {
        ...NO_FILTER,
        propertyFilters: { p1: [NO_PROPERTY_VALUE] },
      }).map((t) => t.id),
    ).toEqual(["1"]);
  });
});

describe("property filters", () => {
  const sevId = "prop-severity";
  const platId = "prop-platforms";
  const doneId = "prop-done";
  const critical = makeTask({ id: "P1", properties: { [sevId]: "opt-critical" } });
  const minor = makeTask({
    id: "P2",
    properties: { [sevId]: "opt-minor", [platId]: ["opt-ios", "opt-web"] },
  });
  const unset = makeTask({ id: "P3" });
  const checked = makeTask({ id: "P4", properties: { [doneId]: true } });

  it("select values match by option id (OR within the definition)", () => {
    const result = filterTasks([critical, minor, unset], {
      ...NO_FILTER,
      propertyFilters: { [sevId]: ["opt-critical", "opt-minor"] },
    });
    expect(result.map((t) => t.id)).toEqual(["P1", "P2"]);
  });

  it("tasks without a value never match a filtered definition", () => {
    const result = filterTasks([critical, unset], {
      ...NO_FILTER,
      propertyFilters: { [sevId]: ["opt-critical"] },
    });
    expect(result.map((t) => t.id)).toEqual(["P1"]);
  });

  it("multi_select matches on intersection", () => {
    const result = filterTasks([critical, minor], {
      ...NO_FILTER,
      propertyFilters: { [platId]: ["opt-web"] },
    });
    expect(result.map((t) => t.id)).toEqual(["P2"]);
  });

  it("checkbox values match the true/false pseudo-options", () => {
    const result = filterTasks([checked, unset], {
      ...NO_FILTER,
      propertyFilters: { [doneId]: ["true"] },
    });
    expect(result.map((t) => t.id)).toEqual(["P4"]);
  });

  it("no-value matches tasks where the property is unset", () => {
    const result = filterTasks([critical, minor, unset, checked], {
      ...NO_FILTER,
      propertyFilters: { [doneId]: [NO_PROPERTY_VALUE] },
    });
    expect(result.map((t) => t.id)).toEqual(["P1", "P2", "P3"]);
  });

  it("no-value ORs with a value within the definition", () => {
    const result = filterTasks([critical, minor, unset, checked], {
      ...NO_FILTER,
      propertyFilters: { [doneId]: ["true", NO_PROPERTY_VALUE] },
    });
    expect(result.map((t) => t.id)).toEqual(["P1", "P2", "P3", "P4"]);
  });

  it("no-value ANDs across definitions", () => {
    const result = filterTasks([critical, minor, unset, checked], {
      ...NO_FILTER,
      propertyFilters: { [sevId]: ["opt-minor"], [doneId]: [NO_PROPERTY_VALUE] },
    });
    expect(result.map((t) => t.id)).toEqual(["P2"]);
  });

  it("ANDs across definitions", () => {
    const result = filterTasks([critical, minor], {
      ...NO_FILTER,
      propertyFilters: { [sevId]: ["opt-minor"], [platId]: ["opt-ios"] },
    });
    expect(result.map((t) => t.id)).toEqual(["P2"]);
  });

  it("empty selections are inert", () => {
    const result = filterTasks([critical, minor, unset], {
      ...NO_FILTER,
      propertyFilters: { [sevId]: [] },
    });
    expect(result).toHaveLength(3);
  });
});
