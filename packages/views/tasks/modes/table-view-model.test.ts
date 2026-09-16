import { describe, expect, it } from "vitest";
import {
  buildTaskTableCsv,
  calculateTaskTableColumn,
  getTaskTableSelectionRange,
  groupLabelFromDescriptor,
  refreshFrozenTableRows,
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
    const labels = {
      translateStatus: (s: string) => `S:${s}`,
      translatePriority: (p: string) => `P:${p}`,
      unassigned: "Unassigned",
      noProject: "No project",
      noValue: "No value",
      checked: "Checked",
      unchecked: "Unchecked",
      resolveAssignee: (id: string) => (id === "u1" ? "Nguyen Ba Vinh" : undefined),
    };
    const label = (key: string, value: Parameters<typeof groupLabelFromDescriptor>[1]) =>
      groupLabelFromDescriptor(key, value, labels);

    expect(label("status:todo", { kind: "status", status: "todo" })).toBe("S:todo");
    expect(label("priority:high", { kind: "priority", priority: "high" })).toBe("P:high");
    expect(
      label("assignee:human:u1", {
        kind: "assignee",
        actor: { type: "human", id: "u1" },
        label: "Vinh (server)",
      }),
    ).toBe("Vinh (server)");
    expect(label("assignee:human:u1", { kind: "assignee", actor: { type: "human", id: "u1" } })).toBe(
      "Nguyen Ba Vinh",
    );
    expect(label("assignee:human:u9", { kind: "assignee", actor: { type: "human", id: "u9" } })).toBe(
      "u9",
    );
    expect(label("assignee:none", { kind: "assignee" })).toBe("Unassigned");
    expect(label("project:p1", { kind: "project", project_id: "p1", label: "Website" })).toBe(
      "Website",
    );
    expect(label("project:none", { kind: "project" })).toBe("No project");
    expect(
      label("property:x:v:YQ", { kind: "property", property_id: "x", option: "a", label: "Alpha" }),
    ).toBe("Alpha");
    expect(label("property:x:v:dHJ1ZQ", { kind: "property", property_id: "x", option: "true" })).toBe(
      "Checked",
    );
    expect(
      label("property:x:v:ZmFsc2U", { kind: "property", property_id: "x", option: "false" }),
    ).toBe("Unchecked");
    expect(label("property:x:none", { kind: "property", property_id: "x" })).toBe("No value");
    expect(label("raw-key", { kind: "other" })).toBe("raw-key");
  });
});
