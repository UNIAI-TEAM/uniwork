"use client";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import * as tasks from "../api/endpoints/tasks";
import type {
  TableFilter,
  TableGroupsBody,
  TableGroupsResult,
  TableRowsResult,
} from "../api/endpoints/tasks-table";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";
import { tableRowsPageBody, tableRowsPageQuery } from "./surface/table-query";

export type { CreateTaskBody, TaskPatch } from "../api/endpoints/tasks";
export { taskKeys } from "./keys";
export { planCacheUpdate } from "./cache-coordinator";
export type { CacheUpdateEvent, CacheUpdatePlan } from "./cache-coordinator";

export * from "./hooks-suite";
export * from "./hooks-catalog";
export * from "./hooks-views";
export * from "./hooks-projects";
export * from "./hooks-collaboration";
export * from "./hooks-attachments";

export function useTasks(workspaceId: string) {
  return useQuery({
    queryKey: taskKeys.list(workspaceId),
    queryFn: () => tasks.listTasks(workspaceId),
    enabled: !!workspaceId,
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => tasks.getTask(taskId),
    enabled: !!taskId,
  });
}

/**
 * List, My Tasks, Gantt and swimlane read infinite queries under these two
 * roots. A local write refreshes them itself rather than waiting for its
 * realtime echo, which never comes while the socket is down. An invalidation
 * replays every loaded page, so each write invalidates each root once.
 */
function invalidatePagedTaskLists(qc: QueryClient, workspaceId: string) {
  void qc.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) });
  void qc.invalidateQueries({ queryKey: taskKeys.myTasks(workspaceId) });
}

export function useCreateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: tasks.CreateTaskBody & { idempotencyKey?: string }) => {
      const { idempotencyKey, ...rest } = body;
      return tasks.createTask(workspaceId, rest, { idempotencyKey });
    },
    onSuccess: () => {
      invalidatePagedTaskLists(qc, workspaceId);
      return qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
    },
  });
}

function applyTaskPatch(task: Task, patch: tasks.TaskPatch): Task {
  return {
    ...task,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ),
  } as Task;
}

/** The body `tableRowsPageBody` builds; a `taskKeys.tableRows` key hashes it as JSON. */
type TableRowsKeyBody = ReturnType<typeof tableRowsPageBody>;
type TableRow = TableRowsResult["rows"][number];
type TableGroup = TableGroupsResult["groups"][number];

/** Rows per page when a body names no limit (the server default). */
const DEFAULT_TABLE_PAGE_LIMIT = 50;

/** The branch a task sits in for each `group_by` the table API can place it by. */
const BRANCH_OF = new Map<string, (task: Task) => string>([
  ["status", (task) => task.status],
  // The server keys the unassigned branch "" (COALESCE(assignee_id, '')).
  ["assignee", (task) => task.assignee_id ?? ""],
]);

const FILTER_FIELD = {
  statuses: "status",
  priorities: "priority",
  assignee_ids: "assignee_id",
  project_ids: "project_id",
} as const;

/** The request body a `taskKeys.tableRows` or `taskKeys.tableGroups` key hashes as its last part. */
function tableKeyBody<Body extends { group_by: string }>(key: QueryKey): Body | null {
  const hash = key[key.length - 1];
  if (typeof hash !== "string") return null;
  try {
    const body: unknown = JSON.parse(hash);
    return typeof body === "object" && body !== null && typeof (body as Body).group_by === "string"
      ? (body as Body)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether the table filter would return the task, as `ListTableTaskRows`
 * reads it: an empty list is no filter, a null field matches no list. A filter
 * field this client does not know admits nothing, so no task is ever placed in
 * a page that filter could exclude it from.
 */
function filterAdmits(filter: TableFilter | undefined, task: Task): boolean {
  return Object.entries(filter ?? {}).every(([name, values]: [string, unknown]) => {
    if (values === undefined || values === null || (Array.isArray(values) && values.length === 0)) {
      return true;
    }
    const field = Object.hasOwn(FILTER_FIELD, name)
      ? FILTER_FIELD[name as keyof typeof FILTER_FIELD]
      : undefined;
    const value = field ? task[field] : undefined;
    return Array.isArray(values) && typeof value === "string" && values.includes(value);
  });
}

/** Server order inside one status branch: `ORDER BY status, position, created_at`. */
function byPosition(a: Task, b: Task): number {
  return a.position - b.position || a.created_at.localeCompare(b.created_at);
}

/**
 * Whether the server would serve `task` on this page of its branch. A page
 * after the first starts at its first row; a full page may continue on the
 * next one, so it ends at its last row; a short page is the branch's last.
 */
function fallsInPage(others: TableRow[], task: Task, offset: number, full: boolean): boolean {
  const first = others[0]?.task;
  const last = others[others.length - 1]?.task;
  if (offset > 0 && (!first || byPosition(task, first) < 0)) return false;
  return !full || (!!last && byPosition(task, last) <= 0);
}

/**
 * One rows page after `patch`. A page the task belongs to keeps its row with
 * the new fields. A page whose branch or filter the task leaves loses the row.
 * Only a status branch, ordered by position, gains a row or reorders one: the
 * page must hold the task already, or be the branch's first page (offset 0),
 * and the position must fall inside it. Any other branch is ordered by status
 * first, which the client cannot collate, so a reassigned task only leaves its
 * assignee branch. Totals follow membership. Returns `data` itself when
 * nothing changed.
 */
function patchTableRowsPage(
  data: TableRowsResult,
  body: TableRowsKeyBody,
  found: TableRow,
  patch: tasks.TaskPatch,
): TableRowsResult {
  const index = data.rows.findIndex((row) => row.task.id === found.task.id);
  const held = index === -1 ? undefined : data.rows[index];
  const before = held?.task ?? found.task;
  const after = applyTaskPatch(before, patch);
  const key = body.group_key;
  const branchOf = typeof key === "string" ? BRANCH_OF.get(body.group_by) : undefined;
  if (typeof key === "string" && !branchOf) {
    // A branch this client cannot place tasks in: refresh fields, move nothing.
    return held ? { ...data, rows: data.rows.with(index, { ...held, task: after }) } : data;
  }
  const admits = (task: Task) => filterAdmits(body.filter, task) && (!branchOf || branchOf(task) === key);
  const wasIn = !!held || admits(before);
  const isIn = admits(after);
  const ordered = body.group_by === "status" && typeof key === "string";
  const moves = ordered && isIn && (!wasIn || after.position !== before.position);

  let rows = data.rows;
  if (held && isIn && !moves) {
    rows = rows.with(index, { ...held, task: after });
  } else if (held || moves) {
    const others = held ? rows.filter((_, i) => i !== index) : rows;
    const offset = body.offset ?? 0;
    // A page of `limit` rows continues on the next page, unless the branch ends with it.
    const full =
      rows.length >= (body.limit ?? DEFAULT_TABLE_PAGE_LIMIT) && offset + rows.length < data.total;
    const lands = moves && (!!held || offset === 0) && fallsInPage(others, after, offset, full);
    if (lands) {
      const at = others.findIndex((row) => byPosition(after, row.task) < 0);
      const placed = { ...(held ?? found), task: after };
      rows = at === -1 ? [...others, placed] : others.toSpliced(at, 0, placed);
    } else {
      rows = others;
    }
  }
  const total = data.total + Number(isIn) - Number(wasIn);
  if (rows === data.rows && total === data.total) return data;
  return { ...data, rows, total, branch_total: data.branch_total + rows.length - data.rows.length };
}

/**
 * One status `group` of a groups result counting one task more or less. A
 * group missing from the result joins it in server order (`ORDER BY status`;
 * status keys are plain lowercase); a group that empties leaves, as the server
 * leaves out a status with no tasks.
 */
function countInGroup(groups: TableGroup[], status: string, delta: 1 | -1): TableGroup[] {
  const index = groups.findIndex((group) => group.key === status);
  const group = groups[index];
  if (!group) {
    if (delta < 0) return groups;
    const added: TableGroup = { key: status, value: { kind: "status", status }, count: 1 };
    const at = groups.findIndex((other) => other.key > status);
    return at === -1 ? [...groups, added] : groups.toSpliced(at, 0, added);
  }
  const count = group.count + delta;
  return count > 0 ? groups.with(index, { ...group, count }) : groups.toSpliced(index, 1);
}

/**
 * Status groups after the task goes from `before` to `after`: the group the
 * filter counted it in loses it, the group the filter now counts it in gains
 * it. Returns `data` itself when nothing changed.
 */
function patchStatusGroups(
  data: TableGroupsResult,
  filter: TableFilter | undefined,
  before: Task,
  after: Task,
): TableGroupsResult {
  const wasIn = filterAdmits(filter, before);
  const isIn = filterAdmits(filter, after);
  if (wasIn === isIn && (!wasIn || before.status === after.status)) return data;
  let groups = data.groups;
  if (wasIn) groups = countInGroup(groups, before.status, -1);
  if (isIn) groups = countInGroup(groups, after.status, 1);
  return { ...data, groups, total: data.total + Number(isIn) - Number(wasIn) };
}

/**
 * The first rows page of the status column the task moves into, when that
 * column had no tasks: a board asks such a column for no rows, so no page
 * exists to insert into. The key is built from the groups entry's own body,
 * byte for byte the one the board and the table view ask for, so the column
 * shows the task at once. Null when the filter excludes the task, the column
 * already counted tasks (their rows may simply not be loaded), or an entry
 * already sits under that key.
 */
function seededFirstPage(
  qc: QueryClient,
  workspaceId: string,
  body: TableGroupsBody,
  groupsBefore: TableGroupsResult,
  row: TableRow,
  after: Task,
): { key: QueryKey; page: TableRowsResult } | null {
  if (!filterAdmits(body.filter, after) || !Array.isArray(body.columns) || typeof body.limit !== "number") {
    return null;
  }
  if (groupsBefore.groups.some((group) => group.key === after.status && group.count > 0)) return null;
  const { queryKey } = tableRowsPageQuery(
    workspaceId,
    tableRowsPageBody({
      filter: body.filter,
      groupBy: body.group_by,
      groupKey: after.status,
      columns: body.columns,
      limit: body.limit,
      offset: 0,
    }),
  );
  if (qc.getQueryState(queryKey)) return null;
  return {
    key: queryKey,
    page: {
      query_fingerprint: groupsBefore.query_fingerprint,
      group_key: after.status,
      parent_id: null,
      total: 1,
      rows: [{ ...row, task: after }],
      branch_total: 1,
      next_cursor: null,
    },
  };
}

/**
 * One table cache entry a task update wrote: what it held before (`undefined`
 * when the update created it) and what the update left in it.
 */
interface TableCacheWrite {
  key: QueryKey;
  before: TableRowsResult | TableGroupsResult | undefined;
  after: TableRowsResult | TableGroupsResult;
}

/**
 * Apply a task update to the table API caches the board and the table view
 * read: every loaded rows page, the counts of every status groups entry, and
 * a first page for an empty status column the task moves into. The task's
 * fields come from its newest cached copy (highest `revision`), so a stale
 * inactive page cached first does not decide where it was. Returns every
 * write, for a rollback that undoes only entries nothing has rewritten since.
 */
function patchTableCaches(
  qc: QueryClient,
  workspaceId: string,
  taskId: string,
  patch: tasks.TaskPatch,
): TableCacheWrite[] {
  const writes: TableCacheWrite[] = [];
  const write = (key: QueryKey, before: TableCacheWrite["before"], next: TableCacheWrite["after"]) => {
    // Structural sharing stores a copy that reuses unchanged parts; the rollback compares against that copy.
    const after = qc.setQueryData<TableCacheWrite["after"]>(key, next) ?? next;
    writes.push({ key, before, after });
  };
  // Row pages only (`tableRows` minus its hash): groups and facets hold no tasks.
  const pages = qc.getQueriesData<TableRowsResult>({
    queryKey: taskKeys.tableRows(workspaceId, "").slice(0, -1),
  });
  let found: TableRow | undefined;
  for (const [, data] of pages) {
    if (!data || !Array.isArray(data.rows)) continue;
    const row = data.rows.find((candidate) => candidate.task.id === taskId);
    if (row && (!found || row.task.revision > found.task.revision)) found = row;
  }
  if (!found) return writes;
  for (const [key, data] of pages) {
    const body = tableKeyBody<TableRowsKeyBody>(key);
    if (!body || !data || !Array.isArray(data.rows)) continue;
    const next = patchTableRowsPage(data, body, found, patch);
    if (next !== data) write(key, data, next);
  }

  const before = found.task;
  const after = applyTaskPatch(before, patch);
  const groupsEntries = qc.getQueriesData<TableGroupsResult>({
    queryKey: taskKeys.tableGroups(workspaceId, "").slice(0, -1),
  });
  for (const [key, data] of groupsEntries) {
    const body = tableKeyBody<TableGroupsBody>(key);
    // Only status groups: the client can place a task by its status alone.
    if (body?.group_by !== "status" || !data || !Array.isArray(data.groups)) continue;
    const next = patchStatusGroups(data, body.filter, before, after);
    if (next !== data) write(key, data, next);
    const seed = seededFirstPage(qc, workspaceId, body, data, found, after);
    if (seed) write(seed.key, undefined, seed.page);
  }
  return writes;
}

export function useUpdateTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: tasks.TaskPatch }) =>
      tasks.updateTask(taskId, patch),
    // Optimistic on purpose, and only here: a status/position patch is locally
    // predictable, the user stays on the board, failure is rare and the
    // rollback is a cache restore. Create/delete flows stay pessimistic.
    // The board and the table read `taskKeys.tableRows` pages and status
    // `taskKeys.tableGroups` counts, so the drop is applied there too (an empty
    // target column gets its first page) and does not snap back until the
    // refetch lands. The infinite list pages are refreshed on settle, never
    // patched.
    onMutate: async ({ taskId, patch }) => {
      await qc.cancelQueries({ queryKey: taskKeys.list(workspaceId) });
      await qc.cancelQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      const prev = qc.getQueryData<Task[]>(taskKeys.list(workspaceId));
      if (prev) {
        qc.setQueryData<Task[]>(
          taskKeys.list(workspaceId),
          prev.map((t) => (t.id === taskId ? applyTaskPatch(t, patch) : t)),
        );
      }
      const tableWrites = patchTableCaches(qc, workspaceId, taskId, patch);
      return { prev, tableWrites };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(taskKeys.list(workspaceId), ctx.prev);
      for (const { key, before, after } of ctx?.tableWrites ?? []) {
        // Rewritten since (a refetch, another member's event): newer than the snapshot, so it stays.
        if (qc.getQueryData(key) !== after) continue;
        if (before === undefined) qc.removeQueries({ queryKey: key, exact: true });
        else qc.setQueryData(key, before);
      }
    },
    onSettled: (_d, _e, { taskId }) => {
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      invalidatePagedTaskLists(qc, workspaceId);
      void qc.invalidateQueries({ queryKey: taskKeys.tableRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}

export function useDeleteTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => tasks.deleteTask(taskId),
    onSuccess: () => {
      invalidatePagedTaskLists(qc, workspaceId);
      return qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
    },
  });
}

export function useComments(taskId: string) {
  return useQuery({
    queryKey: taskKeys.comments(taskId),
    queryFn: () => tasks.listComments(taskId),
    enabled: !!taskId,
  });
}

export function useAddComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => tasks.addComment(taskId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.comments(taskId) }),
  });
}
