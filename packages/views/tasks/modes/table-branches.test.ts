import { describe, expect, it } from "vitest";
import type { TableGroupsResult, TableRowsResult } from "@uniwork/core/api/endpoints/tasks-table";
import type { Task } from "@uniwork/core/types";
import type { CursorBranchState } from "../surface/use-cursor-branches";
import {
  buildDisplayRows,
  expandedParentsInView,
  planBranches,
  tableBranchKey,
  tableGroupByParam,
} from "./table-branches";

const baseBody = {
  query: {},
  group_by: "status",
  hierarchy: true,
  limit: 50,
};

function task(id: string, parent?: string): Task {
  return {
    id,
    organization_id: "",
    workspace_id: "w1",
    number: 1,
    identifier: id,
    revision: 1,
    title: id,
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
    parent_task_id: parent,
  };
}

function branch(
  key: string,
  rows: Array<[string, number]>,
  over: Partial<CursorBranchState> = {},
): CursorBranchState {
  const tableRows: TableRowsResult["rows"] = rows.map(([id, children]) => ({
    task: task(id),
    direct_child_count: children,
    labels: [],
  }));
  return {
    key,
    rows: tableRows,
    total: tableRows.length,
    isLoading: false,
    isFetchingMore: false,
    isError: false,
    hasMore: false,
    loadMore: () => {},
    retry: () => {},
    ...over,
  };
}

const groups: TableGroupsResult["groups"] = [
  { key: "status:todo", value: { kind: "status", status: "todo" }, count: 2 },
  { key: "status:done", value: { kind: "status", status: "done" }, count: 1 },
];

const label = (group: TableGroupsResult["groups"][number]) => group.value.status ?? group.key;

describe("tableGroupByParam", () => {
  it("passes every grouping the table API knows through", () => {
    expect(tableGroupByParam("none")).toBe("none");
    expect(tableGroupByParam("status")).toBe("status");
    expect(tableGroupByParam("priority")).toBe("priority");
    expect(tableGroupByParam("assignee")).toBe("assignee");
    expect(tableGroupByParam("project")).toBe("project");
    expect(tableGroupByParam("property:p1")).toBe("property:p1");
  });

  it("pages an unknown or empty property grouping ungrouped", () => {
    expect(tableGroupByParam("property:" as never)).toBe("none");
    expect(tableGroupByParam("bogus" as never)).toBe("none");
  });
});

describe("planBranches", () => {
  it("asks no branch for a collapsed group", () => {
    const specs = planBranches({
      groupBy: "status",
      groups,
      collapsedGroups: new Set(["status:done"]),
      hierarchy: true,
      expandedParents: [],
      baseBody,
    });
    expect(specs.map((s) => s.key)).toEqual(["status:todo::root"]);
    expect(specs[0]?.body).toEqual({
      query: {},
      group_by: "status",
      group_key: "status:todo",
      hierarchy: true,
      parent_id: null,
      cursor: null,
      limit: 50,
    });
  });

  it("asks one ungrouped root branch without groups", () => {
    const specs = planBranches({
      groupBy: "none",
      groups: undefined,
      collapsedGroups: new Set(),
      hierarchy: true,
      expandedParents: [{ groupKey: null, parentId: "p1" }],
      baseBody: { ...baseBody, group_by: "none" },
    });
    expect(specs.map((s) => s.key)).toEqual(["__ungrouped::root", "__ungrouped::p1"]);
    expect(specs[1]?.body).toMatchObject({ group_key: null, parent_id: "p1", cursor: null });
  });

  it("adds a child branch for an expanded parent under its group", () => {
    const specs = planBranches({
      groupBy: "status",
      groups,
      collapsedGroups: new Set(["status:done"]),
      hierarchy: true,
      expandedParents: [
        { groupKey: "status:todo", parentId: "p1" },
        { groupKey: "status:done", parentId: "p2" },
      ],
      baseBody,
    });
    expect(specs.map((s) => s.key)).toEqual(["status:todo::root", "status:todo::p1"]);
    expect(specs[1]?.body).toMatchObject({ group_key: "status:todo", parent_id: "p1" });
    expect(tableBranchKey("status:todo", "p1")).toBe("status:todo::p1");
  });

  it("asks no child branch when the table is flat", () => {
    const specs = planBranches({
      groupBy: "none",
      groups: undefined,
      collapsedGroups: new Set(),
      hierarchy: false,
      expandedParents: [{ groupKey: null, parentId: "p1" }],
      baseBody: { ...baseBody, group_by: "none", hierarchy: false },
    });
    expect(specs.map((s) => s.key)).toEqual(["__ungrouped::root"]);
  });
});

describe("buildDisplayRows", () => {
  it("renders an expanded parent's children after it, then their load-more row", () => {
    const branches = new Map([
      ["status:todo::root", branch("status:todo::root", [["p1", 2], ["t2", 0]])],
      [
        "status:todo::p1",
        branch("status:todo::p1", [["c1", 0]], { hasMore: true, total: 2 }),
      ],
    ]);
    const rows = buildDisplayRows({
      groupBy: "status",
      groups: groups.slice(0, 1),
      branches,
      collapsedGroups: new Set(),
      hierarchy: true,
      expandedParents: new Set(["p1"]),
      groupLabel: label,
    });
    expect(
      rows.map((row) =>
        row.kind === "task"
          ? `${row.task.id}@${row.depth}${row.hasChildren ? (row.collapsed ? "+" : "-") : ""}`
          : row.kind === "load_more"
            ? `more:${row.key}@${row.depth ?? 0}`
            : `${row.kind}:${row.key}`,
      ),
    ).toEqual([
      "group:status:todo",
      "p1@0-",
      "c1@1",
      "more:load_more:status:todo::p1@1",
      "t2@0",
    ]);
  });

  it("shows a parent closed until it is expanded, and a placeholder while its children load", () => {
    const branches = new Map([["__ungrouped::root", branch("__ungrouped::root", [["p1", 1]])]]);
    const input = {
      groupBy: "none",
      groups: undefined,
      branches,
      collapsedGroups: new Set<string>(),
      hierarchy: true,
      groupLabel: label,
    };
    expect(buildDisplayRows({ ...input, expandedParents: new Set() })).toMatchObject([
      { kind: "task", key: "p1", hasChildren: true, collapsed: true },
    ]);
    expect(
      buildDisplayRows({ ...input, expandedParents: new Set(["p1"]) }).map((row) => row.kind),
    ).toEqual(["task", "skeleton"]);
  });

  it("indents a child branch's placeholder at the branch depth", () => {
    const branches = new Map([["__ungrouped::root", branch("__ungrouped::root", [["p1", 1]])]]);
    const rows = buildDisplayRows({
      groupBy: "none",
      groups: undefined,
      branches,
      collapsedGroups: new Set<string>(),
      hierarchy: true,
      expandedParents: new Set(["p1"]),
      groupLabel: label,
    });
    expect(rows[1]).toMatchObject({ kind: "skeleton", depth: 1 });
  });

  it("gives a group header the colour its callback resolves", () => {
    const rows = buildDisplayRows({
      groupBy: "status",
      groups: groups.slice(0, 1),
      branches: new Map(),
      collapsedGroups: new Set(["status:todo"]),
      hierarchy: true,
      expandedParents: new Set(),
      groupLabel: label,
      groupColor: (group) => (group.key === "status:todo" ? "#22c55e" : undefined),
    });
    expect(rows[0]).toMatchObject({ kind: "group", color: "#22c55e" });
  });

  it("renders a task id once", () => {
    const branches = new Map([
      ["__ungrouped::root", branch("__ungrouped::root", [["p1", 1], ["c1", 0]])],
      ["__ungrouped::p1", branch("__ungrouped::p1", [["c1", 0], ["p1", 0]])],
    ]);
    const rows = buildDisplayRows({
      groupBy: "none",
      groups: undefined,
      branches,
      collapsedGroups: new Set(),
      hierarchy: true,
      expandedParents: new Set(["p1"]),
      groupLabel: label,
    });
    expect(rows.map((row) => row.key)).toEqual(["p1", "c1"]);
  });

  it("shows no disclosure in a flat table", () => {
    const branches = new Map([["__ungrouped::root", branch("__ungrouped::root", [["p1", 3]])]]);
    expect(
      buildDisplayRows({
        groupBy: "none",
        groups: undefined,
        branches,
        collapsedGroups: new Set(),
        hierarchy: false,
        expandedParents: new Set(["p1"]),
        groupLabel: label,
      }),
    ).toMatchObject([{ kind: "task", key: "p1", hasChildren: false, collapsed: false, depth: 0 }]);
  });

  it("keeps a collapsed group's header and skips its rows", () => {
    const rows = buildDisplayRows({
      groupBy: "status",
      groups,
      branches: new Map([["status:todo::root", branch("status:todo::root", [["t1", 0]])]]),
      collapsedGroups: new Set(["status:done"]),
      hierarchy: true,
      expandedParents: new Set(),
      groupLabel: label,
    });
    expect(rows.map((row) => `${row.kind}:${row.key}`)).toEqual([
      "group:status:todo",
      "task:t1",
      "group:status:done",
    ]);
    expect(rows[2]).toMatchObject({ label: "done", count: 1, collapsed: true });
  });
});

describe("expandedParentsInView", () => {
  it("lists expanded parents on screen with their group, nested ones once their parent loaded", () => {
    const branches = new Map([
      ["status:todo::root", branch("status:todo::root", [["p1", 1], ["p9", 1]])],
      ["status:todo::p1", branch("status:todo::p1", [["c1", 1]])],
    ]);
    expect(
      expandedParentsInView({
        groupBy: "status",
        groups,
        branches,
        collapsedGroups: new Set(),
        hierarchy: true,
        expandedParents: new Set(["p1", "c1", "gone"]),
      }),
    ).toEqual([
      { groupKey: "status:todo", parentId: "p1" },
      { groupKey: "status:todo", parentId: "c1" },
    ]);
  });
});
