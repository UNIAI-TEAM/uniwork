import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { TableFilter, TableGroupsResult, TableRowsResult } from "../api/endpoints/tasks-table";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";
import { tableGroupsBody, tableRowsPageBody, tableRowsPageQuery } from "./surface/table-query";
import { patchTableCaches } from "./table-cache-patch";

const WS = "ws1";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    organization_id: "o1",
    workspace_id: WS,
    number: 1,
    identifier: "",
    revision: 1,
    title: id,
    description: "",
    status: "todo",
    priority: "medium",
    assignee_id: "u1",
    assignee_kind: "human",
    project_id: "p1",
    position: 1,
    kind: "normal",
    created_by: "u1",
    created_by_kind: "human",
    created_at: "2026-09-14T00:00:00Z",
    updated_at: "2026-09-14T00:00:00Z",
    ...over,
  };
}

/** The key one cached rows page sits under, built by the real body/key builders. */
function rowsKey(
  groupKey: string | null,
  opts: { groupBy?: string; filter?: TableFilter; cursor?: string | null } = {},
): readonly unknown[] {
  return tableRowsPageQuery(
    WS,
    tableRowsPageBody({
      query: { filter: opts.filter },
      groupBy: opts.groupBy ?? "status",
      hierarchy: false,
      groupKey,
      parentId: null,
      cursor: opts.cursor ?? null,
      limit: 50,
    }),
  ).queryKey;
}

function rowsPage(tasks: Task[], opts: { total?: number; nextCursor?: string | null } = {}): TableRowsResult {
  return {
    query_fingerprint: "f",
    group_key: null,
    parent_id: null,
    total: opts.total ?? tasks.length,
    rows: tasks.map((t) => ({ task: t, direct_child_count: 0, labels: [] })),
    next_cursor: opts.nextCursor ?? null,
  };
}

function groupsKey(opts: { groupBy?: string; filter?: TableFilter } = {}): readonly unknown[] {
  return taskKeys.tableGroups(
    WS,
    JSON.stringify(tableGroupsBody({ query: { filter: opts.filter }, groupBy: opts.groupBy ?? "status" })),
  );
}

/** Status groups in server order, counts as given; keys are `status:<value>` per the wire contract. */
function groupsResult(counts: Record<string, number>): TableGroupsResult {
  const keys = Object.keys(counts).sort();
  return {
    query_fingerprint: "g",
    total: keys.reduce((sum, key) => sum + counts[key]!, 0),
    groups: keys.map((key) => ({ key: `status:${key}`, value: { kind: "status", status: key }, count: counts[key]! })),
    next_cursor: null,
  };
}

const rowsOf = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryData<TableRowsResult>(key);
const idsOf = (qc: QueryClient, key: readonly unknown[]) => rowsOf(qc, key)?.rows.map((row) => row.task.id);
const countsOf = (qc: QueryClient, key: readonly unknown[]) =>
  qc.getQueryData<TableGroupsResult>(key)?.groups.map((group) => [group.key, group.count]);

describe("patchTableCaches", () => {
  it("is a no-op when the task is not cached in any table page", () => {
    const qc = new QueryClient();
    expect(patchTableCaches(qc, WS, "ghost", { status: "done" })).toEqual([]);
  });

  it("moves the task from its old branch's page into the new branch's cached first page, and moves status group counts", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", position: 1 });
    const B = task("B", { status: "todo", position: 2 });
    const C = task("C", { status: "done", position: 1 });
    const todoKey = rowsKey("status:todo");
    const doneKey = rowsKey("status:done");
    qc.setQueryData(todoKey, rowsPage([A, B]));
    qc.setQueryData(doneKey, rowsPage([C]));
    const board = groupsKey();
    qc.setQueryData(board, groupsResult({ todo: 2, done: 1 }));

    patchTableCaches(qc, WS, "A", { status: "done", position: 0.5 });

    expect(idsOf(qc, todoKey)).toEqual(["B"]);
    expect(rowsOf(qc, todoKey)).toMatchObject({ total: 1 });
    expect(idsOf(qc, doneKey)).toEqual(["A", "C"]);
    expect(rowsOf(qc, doneKey)?.rows[0]?.task).toMatchObject({ id: "A", status: "done", position: 0.5 });
    expect(rowsOf(qc, doneKey)).toMatchObject({ total: 2 });
    expect(countsOf(qc, board)).toEqual([
      ["status:done", 2],
      ["status:todo", 1],
    ]);
    expect(qc.getQueryData<TableGroupsResult>(board)?.total).toBe(3);
  });

  it("reorders a page in place on a position-only change (no status move, no group patch)", () => {
    const qc = new QueryClient();
    const A = task("A", { position: 1 });
    const B = task("B", { position: 2 });
    const key = rowsKey("status:todo");
    qc.setQueryData(key, rowsPage([A, B]));
    const board = groupsKey();
    const boardBefore = groupsResult({ todo: 2 });
    qc.setQueryData(board, boardBefore);

    patchTableCaches(qc, WS, "A", { position: 3 });

    expect(idsOf(qc, key)).toEqual(["B", "A"]);
    expect(rowsOf(qc, key)).toMatchObject({ total: 2 });
    expect(qc.getQueryData(board)).toBe(boardBefore);
  });

  it("never inserts into a later page (non-null cursor) of the target branch, even one already loaded", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", position: 1 });
    const todoKey = rowsKey("status:todo");
    qc.setQueryData(todoKey, rowsPage([A]));
    const rest = Array.from({ length: 3 }, (_, i) => task(`d${i}`, { status: "done", position: 10 + i }));
    const laterKey = rowsKey("status:done", { cursor: "c1" });
    const laterBefore = rowsPage(rest, { nextCursor: null });
    qc.setQueryData(laterKey, laterBefore);
    // No first page of "done" cached at all.

    patchTableCaches(qc, WS, "A", { status: "done", position: 1 });

    expect(qc.getQueryData(laterKey)).toBe(laterBefore);
  });

  it("does not insert past the loaded range of a first page that has more pages after it", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", position: 100 });
    qc.setQueryData(rowsKey("status:todo"), rowsPage([A]));
    const doneFirst = [0, 1, 2].map((i) => task(`d${i}`, { status: "done", position: i }));
    const firstKey = rowsKey("status:done");
    qc.setQueryData(firstKey, rowsPage(doneFirst, { nextCursor: "more" }));

    patchTableCaches(qc, WS, "A", { status: "done", position: 100 });

    expect(idsOf(qc, firstKey)).toEqual(doneFirst.map((t) => t.id));
  });

  it("inserts past the last loaded row when the first page is the whole branch (next_cursor null)", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", position: 100 });
    qc.setQueryData(rowsKey("status:todo"), rowsPage([A]));
    const doneFirst = [0, 1, 2].map((i) => task(`d${i}`, { status: "done", position: i }));
    const firstKey = rowsKey("status:done");
    qc.setQueryData(firstKey, rowsPage(doneFirst, { nextCursor: null }));

    patchTableCaches(qc, WS, "A", { status: "done", position: 100 });

    expect(idsOf(qc, firstKey)).toEqual([...doneFirst.map((t) => t.id), "A"]);
  });

  it("does not insert into a target first page whose filter excludes the task, but does into one whose filter admits it", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", project_id: "p1", position: 1 });
    qc.setQueryData(rowsKey("status:todo", { filter: { project_ids: ["p1"] } }), rowsPage([A]));
    const doneAllKey = rowsKey("status:done");
    const doneP2Key = rowsKey("status:done", { filter: { project_ids: ["p2"] } });
    qc.setQueryData(doneAllKey, rowsPage([]));
    const doneP2Before = rowsPage([]);
    qc.setQueryData(doneP2Key, doneP2Before);

    patchTableCaches(qc, WS, "A", { status: "done", position: 0.5 });

    expect(idsOf(qc, doneAllKey)).toEqual(["A"]);
    expect(qc.getQueryData(doneP2Key)).toBe(doneP2Before);
  });

  it("does not insert (or duplicate) when the task is already present in some other cached page of the target branch", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", position: 1 });
    qc.setQueryData(rowsKey("status:todo"), rowsPage([A]));
    const firstKey = rowsKey("status:done");
    const firstBefore = rowsPage([]);
    qc.setQueryData(firstKey, firstBefore);
    const laterKey = rowsKey("status:done", { cursor: "c1" });
    qc.setQueryData(laterKey, rowsPage([task("A", { status: "done", position: 50 })]));

    patchTableCaches(qc, WS, "A", { status: "done", position: 1 });

    expect(qc.getQueryData(firstKey)).toBe(firstBefore);
    // The later page's own copy still gets its fields refreshed in place.
    expect(idsOf(qc, laterKey)).toEqual(["A"]);
    expect(rowsOf(qc, laterKey)?.rows[0]?.task.position).toBe(1);
  });

  it("updates the row in place on a non-status group_by page, regardless of branch, and never touches groups", () => {
    const qc = new QueryClient();
    const A = task("A", { assignee_id: "u1", status: "todo", position: 1 });
    const key = rowsKey("assignee:human:u1", { groupBy: "assignee" });
    qc.setQueryData(key, rowsPage([A]));
    const board = groupsKey();
    const boardBefore = groupsResult({ todo: 1 });
    qc.setQueryData(board, boardBefore);

    patchTableCaches(qc, WS, "A", { status: "done", position: 5 });

    expect(rowsOf(qc, key)?.rows[0]?.task).toMatchObject({ status: "done", position: 5 });
    expect(rowsOf(qc, key)).toMatchObject({ total: 1 });
    // group_by "assignee" pages are not status groups, and a status change with no
    // group_by:"status" page reassignment target still patches status groups by
    // itself — assert the groups entry did change (status did move) rather than assuming untouched.
    expect(countsOf(qc, board)).toEqual([["status:done", 1]]);
  });

  it("drops the row (and total) from a page whose filter no longer admits the patched task", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", project_id: "p1", position: 1 });
    const key = rowsKey(null, { filter: { project_ids: ["p1"] } });
    qc.setQueryData(key, rowsPage([A]));

    patchTableCaches(qc, WS, "A", { project_id: "p2" });

    expect(idsOf(qc, key)).toEqual([]);
    expect(rowsOf(qc, key)).toMatchObject({ total: 0 });
  });

  it("creates a missing target status group in key order and drops a source group that empties", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", position: 1 });
    qc.setQueryData(rowsKey("status:todo"), rowsPage([A]));
    const board = groupsKey();
    qc.setQueryData(board, groupsResult({ todo: 1 }));

    patchTableCaches(qc, WS, "A", { status: "done", position: 1 });

    expect(countsOf(qc, board)).toEqual([["status:done", 1]]);
  });

  it("takes the task's fields from its newest cached copy (highest revision) across every page", () => {
    const qc = new QueryClient();
    const stale = task("A", { revision: 1, title: "old", status: "todo", position: 1 });
    const fresh = task("A", { revision: 3, title: "new", status: "todo", position: 1 });
    const allKey = rowsKey(null);
    const todoKey = rowsKey("status:todo");
    qc.setQueryData(allKey, rowsPage([stale]));
    qc.setQueryData(todoKey, rowsPage([fresh]));

    patchTableCaches(qc, WS, "A", { status: "done", position: 1 });

    expect(rowsOf(qc, todoKey)).toMatchObject({ rows: [], total: 0 });
    expect(rowsOf(qc, allKey)?.rows[0]?.task).toMatchObject({ revision: 3, title: "new", status: "done" });
  });

  it("does not touch groups or attempt any insertion when status does not change", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", priority: "medium", position: 1 });
    qc.setQueryData(rowsKey("status:todo"), rowsPage([A]));
    const board = groupsKey();
    const boardBefore = groupsResult({ todo: 1 });
    qc.setQueryData(board, boardBefore);

    patchTableCaches(qc, WS, "A", { priority: "urgent" });

    expect(qc.getQueryData(board)).toBe(boardBefore);
    expect(rowsOf(qc, rowsKey("status:todo"))?.rows[0]?.task.priority).toBe("urgent");
  });

  it("returns before/after snapshots a caller can use to roll back", () => {
    const qc = new QueryClient();
    const A = task("A", { status: "todo", position: 1 });
    const todoKey = rowsKey("status:todo");
    const todoBefore = rowsPage([A]);
    qc.setQueryData(todoKey, todoBefore);

    const writes = patchTableCaches(qc, WS, "A", { status: "done", position: 1 });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.before).toBe(todoBefore);
    expect(writes[0]?.after).toBe(qc.getQueryData(todoKey));
  });
});
