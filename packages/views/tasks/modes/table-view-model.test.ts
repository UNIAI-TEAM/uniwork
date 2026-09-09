import { describe, expect, it } from "vitest";
import {
  buildTaskTableCsv,
  calculateTaskTableColumn,
  getTaskTableSelectionRange,
  groupLabelFromDescriptor,
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
    // Default store value "none" is status grouping; label is tasks.table.grouping.none.
    expect(tableGroupBy("none")).toBe("status");
    expect(tableGroupBy("status")).toBe("status");
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

  it("returns null selection without anchor or unknown ids", () => {
    expect(getTaskTableSelectionRange(["a", "b"], null, "b")).toBeNull();
    expect(getTaskTableSelectionRange(["a", "b"], "missing", "b")).toBeNull();
    expect(getTaskTableSelectionRange(["a", "b"], "a", "missing")).toBeNull();
  });

  it("keeps non-task frozen rows and identical task references", () => {
    const snapshot: TaskTableDisplayRow[] = [
      { kind: "group", key: "g", label: "Todo", count: 1, collapsed: false },
      {
        kind: "task",
        key: "t1",
        task: sample,
        depth: 0,
        hasChildren: false,
        collapsed: false,
      },
      { kind: "skeleton", key: "s1" },
    ];
    const same = refreshFrozenTableRows(snapshot, new Map([["t1", sample]]));
    expect(same[0]).toBe(snapshot[0]);
    expect(same[1]).toBe(snapshot[1]);
    expect(same[2]).toBe(snapshot[2]);
  });

  it("calculates count/sum/average across column kinds and skips empties", () => {
    const rows = [
      task({
        id: "a",
        title: "A",
        identifier: "T-1",
        status: "todo",
        priority: "high",
        assignee_id: "u1",
        due_date: "2026-01-01",
        created_by: "u1",
        position: 2,
      }),
      task({
        id: "b",
        title: "",
        identifier: "T-2",
        status: "done",
        priority: "low",
        assignee_id: undefined,
        due_date: undefined,
        created_by: "u2",
        position: 4,
      }),
    ];
    expect(calculateTaskTableColumn(rows, "title", "none")).toBeNull();
    expect(calculateTaskTableColumn(rows, "title", "count")).toBe(1);
    expect(calculateTaskTableColumn(rows, "identifier", "count")).toBe(2);
    expect(calculateTaskTableColumn(rows, "status", "count")).toBe(2);
    expect(calculateTaskTableColumn(rows, "priority", "count")).toBe(2);
    expect(calculateTaskTableColumn(rows, "assignee", "count")).toBe(1);
    expect(calculateTaskTableColumn(rows, "labels", "count")).toBe(0);
    expect(calculateTaskTableColumn(rows, "project", "sum")).toBeNull();
    expect(calculateTaskTableColumn(rows, "start_date", "average")).toBeNull();
    expect(calculateTaskTableColumn(rows, "due_date", "count")).toBe(1);
    expect(calculateTaskTableColumn(rows, "created_at", "count")).toBe(2);
    expect(calculateTaskTableColumn(rows, "updated_at", "count")).toBe(2);
    expect(calculateTaskTableColumn(rows, "child_progress", "count")).toBe(0);
    expect(calculateTaskTableColumn(rows, "creator", "count")).toBe(2);
    expect(calculateTaskTableColumn(rows, "property:x" as never, "count")).toBe(0);
    expect(calculateTaskTableColumn(rows, "position" as never, "sum")).toBeNull();
  });

  it("escapes quotes commas and formula prefixes in CSV cells", () => {
    const csv = buildTaskTableCsv(
      ["A", "B"],
      [
        ['say "hi"', "a,b"],
        ["+cmd", null],
        ["\tTAB", undefined],
        ["ok\nline", "@x"],
      ],
    );
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"a,b"');
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'\tTAB");
    expect(csv).toContain('"ok\nline"');
    expect(csv).toContain("'@x");
  });

  it("maps group descriptors to translated labels", () => {
    expect(
      groupLabelFromDescriptor(
        "status:todo",
        { kind: "status", status: "todo" },
        (s) => `S:${s}`,
        (p) => `P:${p}`,
        "Unassigned",
      ),
    ).toBe("S:todo");
    expect(
      groupLabelFromDescriptor(
        "priority:high",
        { kind: "priority", priority: "high" },
        (s) => s,
        (p) => `P:${p}`,
        "Unassigned",
      ),
    ).toBe("P:high");
    expect(
      groupLabelFromDescriptor(
        "assignee:human:u1",
        { kind: "assignee" },
        (s) => s,
        (p) => p,
        "Unassigned",
      ),
    ).toBe("human:u1");
    expect(
      groupLabelFromDescriptor(
        "assignee",
        { kind: "assignee" },
        (s) => s,
        (p) => p,
        "Unassigned",
      ),
    ).toBe("Unassigned");
    expect(
      groupLabelFromDescriptor(
        "raw-key",
        { kind: "other" },
        (s) => s,
        (p) => p,
        "Unassigned",
      ),
    ).toBe("raw-key");
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
    expect(sortTasksForTable(rows, "created_at", "asc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortTasksForTable(rows, "updated_at", "desc").map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
    expect(sortTasksForTable(rows, "start_date", "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
    expect(
      sortTasksForTable(rows, "property:x" as never, "asc").map((r) => r.id),
    ).toEqual(["b", "a"]);
  });

  it("maps unknown grouping strings to status", () => {
    expect(tableGroupBy("something-else")).toBe("status");
  });
});
