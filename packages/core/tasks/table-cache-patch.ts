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
import { tableRowsPageBody, tableRowsPageQuery } from "./surface/table-query";

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
 * Whether a `hierarchy: true` page's `parent_id` scope still matches
 * `after`'s parent: `parent_id: null` is the root scope (admits only a
 * parentless task), any other `parent_id` admits only a task whose
 * `parent_task_id` equals it. A `hierarchy: false` page carries no such
 * scope and always admits. `parent_task_id` is not a `TaskPatch` field, so a
 * status move never changes it — this only ever excludes a hierarchy branch
 * that was never the task's parent scope (an unrelated expanded parent, or
 * the root scope when the task has a parent), never the task's own current
 * parent's page.
 */
function hierarchyAdmits(body: RowsPageBody, after: Task): boolean {
  if (!body.hierarchy) return true;
  const parent = after.parent_task_id ?? null;
  return body.parent_id === null ? parent === null : body.parent_id === parent;
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
 * filter/sort/hierarchy/parent/limit combination cached simultaneously —
 * provided: the task is not already in any cached page of that specific
 * branch; the page carries no `query.search` (a search-filtered page's match
 * is not something this client can evaluate, so it is left to the settle
 * refetch); a `hierarchy: true` page's `parent_id` scope is the task's own
 * current parent (`hierarchyAdmits`) — an unrelated expanded parent's child
 * page, or the root page when the task has a parent, never gets a row; the
 * page's filter admits `after`; the page is sorted `position asc` (the only
 * order this client can place a row within); and the position falls inside
 * the page (the page is the whole branch — `next_cursor: null` — or the
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
    const query = firstPage.body.query;
    if (!query || query.search) continue;
    if (!hierarchyAdmits(firstPage.body, after)) continue;
    if (!isPositionAsc(query) || !filterAdmits(query.filter, after)) continue;

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

/** The family a rows page belongs to for seeding purposes: same query/hierarchy/parent/limit, any `group_key`. */
function familyHash(body: RowsPageBody): string {
  return JSON.stringify({
    query: body.query,
    group_by: body.group_by,
    hierarchy: body.hierarchy,
    parent_id: body.parent_id,
    limit: body.limit,
  });
}

/**
 * Whether a family's scope may template a brand-new first page seeded for a
 * status it has no page for at all. Narrower than `hierarchyAdmits`: seeding
 * is only safe for a flat query (`hierarchy: false`) or the hierarchy root
 * scope for a task that itself has no parent — never a specific non-root
 * parent's child scope, even the task's own parent's, since that would need
 * the parent subtree's own context this sibling page does not carry.
 */
function canSeedFrom(body: RowsPageBody, after: Task): boolean {
  if (!body.hierarchy) return true;
  return body.parent_id === null && (after.parent_task_id ?? null) === null;
}

/**
 * Seed a brand-new first page for a status branch the cache has no page for
 * at all — one family (same query/hierarchy/parent_id/limit, any
 * `group_key`) at a time — restoring the pre-cursor board's "drop into an
 * empty column" behaviour, narrowly: only when a sibling first page (any
 * other status, `cursor: null`) already sits in the cache to copy
 * `query_fingerprint` from; the family passes `canSeedFrom`; its query
 * carries no `search` (an unevaluable match without the server); and its
 * groups cache entry — looked up by the sibling's own `query` alone, since
 * `TableGroupsBody` carries neither `hierarchy` nor `parent_id` — exists and
 * shows the target status at count 0 or missing (a groups entry that does
 * not exist proves nothing, so that family is left alone). A family that
 * already has a page for the target status, at any cursor, is left to
 * `insertIntoTargetFirstPages` instead — never both. The write is recorded
 * with `before: undefined`, so a rejected move removes the seeded entry
 * rather than trying to restore a "before" that never existed.
 */
function seedEmptyTargetFirstPages(
  qc: QueryClient,
  workspaceId: string,
  statusPages: ParsedRowsPage[],
  after: Task,
  found: { direct_child_count: number; labels: TableRowLabel[] },
  write: (key: QueryKey, before: undefined, next: TableRowsResult) => void,
) {
  const targetKey = statusGroupKey(after.status);
  const families = new Map<string, ParsedRowsPage[]>();
  for (const page of statusPages) {
    const fam = familyHash(page.body);
    const list = families.get(fam) ?? [];
    list.push(page);
    families.set(fam, list);
  }

  for (const family of families.values()) {
    if (family.some((page) => page.body.group_key === targetKey)) continue;
    const sibling = family.find((page) => page.cursor === null);
    if (!sibling) continue;
    const query = sibling.body.query;
    if (!query || query.search) continue;
    if (!canSeedFrom(sibling.body, after)) continue;

    const groupsData = qc.getQueryData<TableGroupsResult>(
      taskKeys.tableGroups(workspaceId, JSON.stringify({ query, group_by: "status" })),
    );
    if (!groupsData || !Array.isArray(groupsData.groups)) continue;
    const existing = groupsData.groups.find((group) => group.key === targetKey);
    if (existing && existing.count > 0) continue;

    const seededBody = tableRowsPageBody({
      query,
      groupBy: sibling.body.group_by,
      hierarchy: sibling.body.hierarchy,
      groupKey: targetKey,
      parentId: sibling.body.parent_id,
      cursor: null,
      limit: sibling.body.limit,
    });
    const { queryKey } = tableRowsPageQuery(workspaceId, seededBody);
    write(queryKey, undefined, {
      query_fingerprint: sibling.data.query_fingerprint,
      group_key: targetKey,
      parent_id: null,
      total: 1,
      rows: [{ task: after, direct_child_count: found.direct_child_count, labels: found.labels }],
      next_cursor: null,
    });
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
    if (!branchAdmits(body, after) || !filterAdmits(body.query?.filter, after)) {
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
    // Reads groups caches at their pre-patch counts, so it runs before the
    // groups loop below adjusts them — otherwise a just-incremented target
    // count would look non-empty to this pass.
    seedEmptyTargetFirstPages(
      qc,
      workspaceId,
      pages.filter((page) => page.body.group_by === "status"),
      after,
      found,
      write,
    );

    const groupsEntries = qc.getQueriesData<TableGroupsResult>({ queryKey: taskKeys.tableRoot(workspaceId) });
    for (const [key, data] of groupsEntries) {
      if (!data || !Array.isArray(data.groups)) continue;
      const body = parseGroupsKey(key);
      if (!body || body.group_by !== "status" || !body.query || body.query.search) continue;
      const next = patchStatusGroups(data, body.query.filter, before, after);
      if (next) write(key, data, next);
    }
  }

  return writes;
}
