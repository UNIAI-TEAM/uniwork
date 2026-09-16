import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { TaskPatch } from "../api/endpoints/tasks";
import type {
  TableFilter,
  TableGroupDescriptor,
  TableGroupsBody,
  TableGroupsResult,
  TableQuery,
  TableRowLabel,
  TableRowsBody,
  TableRowsResult,
} from "../api/endpoints/tasks-table";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";

/**
 * Optimistic cache placement for `useUpdateTask` (the board drag), on the
 * cursor table API. CLAUDE.md State Rules names this the canonical
 * optimistic update, so it stays optimistic across the table's move from
 * offset to cursor pagination rather than falling back to a settle-only
 * invalidate. The offset-era version of this module read `offset` ("is this
 * the branch's first page?") and `branch_total` ("is this page full?")
 * straight off the request body and response; a cursor body carries neither.
 * The cursor-shaped equivalents are: a page's own `cursor` (`null` ⇔ it is
 * the branch's first page) and its cached `next_cursor` (`null` ⇔ it is the
 * branch's last page).
 */

type RowsPageBody = Omit<TableRowsBody, "cursor">;

export interface TableCacheWrite {
  key: QueryKey;
  before: TableRowsResult | TableGroupsResult | undefined;
  after: TableRowsResult | TableGroupsResult;
}

export function applyTaskPatch(task: Task, patch: TaskPatch): Task {
  return {
    ...task,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
  } as Task;
}

const statusGroupKey = (status: string) => `status:${status}`;

const FILTER_FIELD = {
  statuses: "status",
  priorities: "priority",
  assignee_ids: "assignee_id",
  project_ids: "project_id",
} as const;

/**
 * Whether the table filter would return the task: an empty (or absent) list
 * is no filter, a filter field this client does not know admits nothing, so
 * no task is ever placed in a page that filter could exclude it from.
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

/** The server default (and the only order this client can place a row within): `position asc`. */
function isPositionAsc(query: TableQuery | undefined): boolean {
  return !query?.sort || (query.sort.field === "position" && query.sort.direction === "asc");
}

/**
 * Whether a page's branch would still hold `after`. Only `group_by: "status"`
 * is orderable/reassignable by this client; every other grouping (assignee,
 * priority, a property, …) keeps whatever branch it already sits in — a
 * reassignment there is not something the client can place, so it is left to
 * the settle refetch by staying "admitted" here and losing the row only
 * through `filterAdmits`. A `group_key: null` page is the ungrouped branch:
 * no status restricts it.
 */
function branchAdmits(body: RowsPageBody, after: Task): boolean {
  if (body.group_by !== "status") return true;
  if (body.group_key === null) return true;
  return body.group_key === statusGroupKey(after.status);
}

/** Parses a rows-page key (`["tasks-table", ws, "rows", bodyHash, cursorSeg]`) back into its body and cursor. */
function parseRowsKey(key: QueryKey): { bodyHash: string; body: RowsPageBody; cursor: string | null } | null {
  if (key.length !== 5 || key[0] !== "tasks-table" || key[2] !== "rows") return null;
  const bodyHash = key[3];
  const cursorSeg = key[4];
  if (typeof bodyHash !== "string" || typeof cursorSeg !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyHash);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as RowsPageBody).group_by !== "string") {
    return null;
  }
  return { bodyHash, body: parsed as RowsPageBody, cursor: cursorSeg === "" ? null : cursorSeg };
}

/** Parses a groups key (`["tasks-table", ws, "groups", hash]`) back into its body. */
function parseGroupsKey(key: QueryKey): TableGroupsBody | null {
  if (key.length !== 4 || key[0] !== "tasks-table" || key[2] !== "groups") return null;
  const hash = key[3];
  if (typeof hash !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(hash);
    if (typeof parsed !== "object" || parsed === null || typeof (parsed as TableGroupsBody).group_by !== "string") {
      return null;
    }
    return parsed as TableGroupsBody;
  } catch {
    return null;
  }
}

/**
 * One status `group` counting one task more or less. A group missing from
 * the result joins it in server order (`ORDER BY status`; keys are
 * `status:<value>`, so string order over the whole key matches string order
 * over the bare status); a group that empties leaves, as the server leaves
 * out a status with no tasks.
 */
function countInGroup(groups: TableGroupDescriptor[], status: string, delta: 1 | -1): TableGroupDescriptor[] {
  const key = statusGroupKey(status);
  const index = groups.findIndex((group) => group.key === key);
  const group = groups[index];
  if (!group) {
    if (delta < 0) return groups;
    const added: TableGroupDescriptor = { key, value: { kind: "status", status }, count: 1 };
    const at = groups.findIndex((other) => other.key > key);
    return at === -1 ? [...groups, added] : groups.toSpliced(at, 0, added);
  }
  const count = group.count + delta;
  return count > 0 ? groups.with(index, { ...group, count }) : groups.toSpliced(index, 1);
}

/**
 * Status groups after the task goes from `before` to `after`. Returns
 * `undefined` when nothing changed (the filter's admission of the task did
 * not change, or it stayed admitted under the same status).
 */
function patchStatusGroups(
  data: TableGroupsResult,
  filter: TableFilter | undefined,
  before: Task,
  after: Task,
): TableGroupsResult | undefined {
  const wasIn = filterAdmits(filter, before);
  const isIn = filterAdmits(filter, after);
  if (wasIn === isIn && (!wasIn || before.status === after.status)) return undefined;
  let groups = data.groups;
  if (wasIn) groups = countInGroup(groups, before.status, -1);
  if (isIn) groups = countInGroup(groups, after.status, 1);
  return { ...data, groups, total: data.total + Number(isIn) - Number(wasIn) };
}

type ParsedRowsPage = {
  key: QueryKey;
  data: TableRowsResult;
  bodyHash: string;
  body: RowsPageBody;
  cursor: string | null;
};

function readRowsPages(qc: QueryClient, workspaceId: string): ParsedRowsPage[] {
  const entries = qc.getQueriesData<TableRowsResult>({ queryKey: taskKeys.tableRoot(workspaceId) });
  const pages: ParsedRowsPage[] = [];
  for (const [key, data] of entries) {
    if (!data || !Array.isArray(data.rows)) continue;
    const parsed = parseRowsKey(key);
    if (parsed) pages.push({ key, data, ...parsed });
  }
  return pages;
}

/**
 * Insert the moved task into every already-cached first page (`cursor:
 * null`) of a branch keyed `status:<after.status>` — one per distinct
 * filter/sort/limit combination cached simultaneously — provided: the task
 * is not already in any cached page of that specific branch; the page's
 * filter admits `after`; the page is sorted `position asc` (the only order
 * this client can place a row within); and the position falls inside the
 * page (the page is the whole branch — `next_cursor: null` — or the
 * position does not exceed the last loaded row's). A branch with no first
 * page cached is left alone: this never fabricates a new query entry, only
 * patches ones already sitting in the cache. Later pages of the branch are
 * only ever updated in place or have the row removed by the caller's main
 * pass, never inserted into.
 */
function insertIntoTargetFirstPages(
  pages: ParsedRowsPage[],
  after: Task,
  found: { direct_child_count: number; labels: TableRowLabel[] },
  taskId: string,
  write: (key: QueryKey, before: TableRowsResult, next: TableRowsResult) => void,
) {
  const targetKey = statusGroupKey(after.status);
  const branches = new Map<string, ParsedRowsPage[]>();
  for (const page of pages) {
    if (page.body.group_by !== "status" || page.body.group_key !== targetKey) continue;
    const list = branches.get(page.bodyHash) ?? [];
    list.push(page);
    branches.set(page.bodyHash, list);
  }

  for (const branchPages of branches.values()) {
    if (branchPages.some((page) => page.data.rows.some((row) => row.task.id === taskId))) continue;
    const firstPage = branchPages.find((page) => page.cursor === null);
    if (!firstPage) continue;
    if (!isPositionAsc(firstPage.body.query) || !filterAdmits(firstPage.body.query.filter, after)) continue;

    const rows = firstPage.data.rows;
    const lastRow = rows[rows.length - 1];
    const fits = firstPage.data.next_cursor === null || (!!lastRow && after.position <= lastRow.task.position);
    if (!fits) continue;

    const insertAt = rows.findIndex((row) => row.task.position > after.position);
    const newRow = { task: after, direct_child_count: found.direct_child_count, labels: found.labels };
    const nextRows = insertAt === -1 ? [...rows, newRow] : rows.toSpliced(insertAt, 0, newRow);
    write(firstPage.key, firstPage.data, { ...firstPage.data, rows: nextRows, total: firstPage.data.total + 1 });
  }
}

/**
 * Apply a task update to the table API caches the board and the table view
 * read: every cached rows page that already holds the task (updated in place,
 * reordered when the page is `position asc`, or dropped when the task's
 * branch/filter no longer admits it), the newly-branched status's already-
 * cached first pages (a row inserted, per branch/filter — see
 * `insertIntoTargetFirstPages`), and the counts of every status groups entry.
 * The task's fields come from its newest cached copy (highest `revision`), so
 * a stale inactive page cached first does not decide where it was. Returns
 * every write, for a rollback that undoes only entries nothing has rewritten
 * since.
 */
export function patchTableCaches(
  qc: QueryClient,
  workspaceId: string,
  taskId: string,
  patch: TaskPatch,
): TableCacheWrite[] {
  const writes: TableCacheWrite[] = [];
  const write = (key: QueryKey, before: TableCacheWrite["before"], next: TableCacheWrite["after"]) => {
    // Structural sharing stores a copy that reuses unchanged parts; the rollback compares against that copy.
    const after = qc.setQueryData<TableCacheWrite["after"]>(key, next) ?? next;
    writes.push({ key, before, after });
  };

  const pages = readRowsPages(qc, workspaceId);
  let found: TableRowsResult["rows"][number] | undefined;
  for (const { data } of pages) {
    const row = data.rows.find((candidate) => candidate.task.id === taskId);
    if (row && (!found || row.task.revision > found.task.revision)) found = row;
  }
  if (!found) return writes;

  const before = found.task;
  const after = applyTaskPatch(before, patch);

  for (const { key, data, body } of pages) {
    const index = data.rows.findIndex((row) => row.task.id === taskId);
    if (index === -1) continue;
    if (!branchAdmits(body, after) || !filterAdmits(body.query.filter, after)) {
      write(key, data, { ...data, rows: data.rows.toSpliced(index, 1), total: data.total - 1 });
      continue;
    }
    let rows = data.rows.with(index, { ...data.rows[index]!, task: after });
    if (isPositionAsc(body.query)) rows = [...rows].sort((a, b) => a.task.position - b.task.position);
    write(key, data, { ...data, rows });
  }

  const statusChanged = typeof patch.status === "string" && patch.status !== before.status;
  if (statusChanged) {
    insertIntoTargetFirstPages(pages, after, found, taskId, write);

    const groupsEntries = qc.getQueriesData<TableGroupsResult>({ queryKey: taskKeys.tableRoot(workspaceId) });
    for (const [key, data] of groupsEntries) {
      if (!data || !Array.isArray(data.groups)) continue;
      const body = parseGroupsKey(key);
      if (!body || body.group_by !== "status") continue;
      const next = patchStatusGroups(data, body.query.filter, before, after);
      if (next) write(key, data, next);
    }
  }

  return writes;
}
