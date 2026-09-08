import { describe, expect, it } from "vitest";
import {
  buildTaskTableCsv,
  calculateTaskTableColumn,
  getTaskTableSelectionRange,
  refreshFrozenTableRows,
  sortTasksForTable,
  tableGroupBy,
  type TaskTableDisplayRow,
} from "./table-view-model";
import type { Task } from "@uniwork/core/types";

const sample: Task = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "Alpha",
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

function task(over: Partial<Task> & { id: string; title: string }): Task {
  return { ...sample, ...over };
}

describe("table-view-model", () => {
  it("maps grouping to suite group_by and stubs project when unavailable", () => {
    expect(tableGroupBy("none")).toBe("status");
    expect(tableGroupBy("assignee")).toBe("assignee");
    expect(tableGroupBy("project", { projectsAvailable: false })).toBe("status");
    expect(tableGroupBy("project", { projectsAvailable: true })).toBe("project");
    expect(tableGroupBy("property:abc")).toBe("status");
  });

  it("builds selection ranges and refreshes frozen task rows", () => {
    expect(getTaskTableSelectionRange(["a", "b", "c"], "a", "c")).toEqual([
      "a",
      "b",
      "c",
    ]);
    const snapshot: TaskTableDisplayRow[] = [
      {
        kind: "task",
        key: "t1",
        task: sample,
        depth: 0,
        hasChildren: false,
        collapsed: false,
      },
    ];
    const live = { ...sample, title: "Beta" };
    const next = refreshFrozenTableRows(snapshot, new Map([["t1", live]]));
    expect(next[0]).toMatchObject({ kind: "task", task: { title: "Beta" } });
  });

  it("counts column values and escapes CSV formula cells", () => {
    expect(calculateTaskTableColumn([sample], "title", "count")).toBe(1);
    expect(calculateTaskTableColumn([sample], "title", "sum")).toBeNull();
    const csv = buildTaskTableCsv(["Title"], [["=1+1"], ["ok"]]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("ok");
  });

  it("client-sorts loaded rows by title status priority and due date", () => {
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
    expect(sortTasksForTable(rows, "title", "asc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortTasksForTable(rows, "title", "desc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    // Catalog order: done after todo; low before high.
    expect(sortTasksForTable(rows, "status", "asc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortTasksForTable(rows, "priority", "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    expect(sortTasksForTable(rows, "due_date", "asc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortTasksForTable(rows, "position", "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
