import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";

/**
 * Client copy of the `Patch` list on the `task.updated` row of
 * server/internal/outbox/catalogue.go (ADR 0015). Kept on one line:
 * scripts/events-catalogue.test.mjs reads it and fails when the two differ,
 * because a server field missing here would be skipped while the cache still
 * takes the frame's revision.
 */
const TASK_PATCH_FIELDS = ["title", "status", "priority", "due_date"] as const;

type TaskPatchFields = {
  title?: string;
  status?: string;
  priority?: string;
  /** `null` when the frame cleared the date (the server sends ""). */
  due_date?: string | null;
};

/** A `task.updated` frame that describes one whole update call (ADR 0015 Decision 3). */
export type TaskPatchFrame = {
  taskId: string;
  revisionBefore: number;
  revision: number;
  fields: TaskPatchFields;
};

const REVISION = /^\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseRevision(value: unknown): number | null {
  if (typeof value !== "string" || !REVISION.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Decode a `task.updated` payload into a patch, or `null` when the frame is
 * ids-only for the client (ADR 0015 Decisions 4 and 5): no `task_id`, a
 * missing or malformed revision, `revision <= revision_before`, or no Patch
 * field at all. Keys outside `TASK_PATCH_FIELDS` are ignored. A Patch field
 * that cannot be applied (not a string, a date not `YYYY-MM-DD`) rejects the
 * whole frame: dropping it and still taking the revision would leave that
 * field stale behind a current revision.
 */
export function parseTaskPatchFrame(payload: Readonly<Record<string, unknown>>): TaskPatchFrame | null {
  const taskId = payload.task_id;
  if (typeof taskId !== "string" || taskId === "") return null;
  const revisionBefore = parseRevision(payload.revision_before);
  const revision = parseRevision(payload.revision);
  if (revisionBefore === null || revision === null || revision <= revisionBefore) return null;

  const fields: TaskPatchFields = {};
  let present = 0;
  for (const field of TASK_PATCH_FIELDS) {
    const value = payload[field];
    if (value === undefined) continue;
    if (typeof value !== "string") return null;
    present++;
    if (field === "due_date") {
      if (value !== "" && !DATE.test(value)) return null;
      fields.due_date = value === "" ? null : value;
    } else {
      fields[field] = value;
    }
  }
  return present > 0 ? { taskId, revisionBefore, revision, fields } : null;
}

/** The record the frame describes, or the same reference when the guard fails. */
function patchRow(row: Task, frame: TaskPatchFrame): Task {
  if (row?.id !== frame.taskId || row.revision !== frame.revisionBefore) return row;
  const { due_date: dueDate, ...rest } = frame.fields;
  // status/priority stay whatever string the server sent, as the lenient
  // response schema would have parsed them.
  const next = { ...row, ...rest, revision: frame.revision } as Task;
  // REST omits a cleared due date (`omitempty`); the patched record matches it.
  if (dueDate === null) delete next.due_date;
  else if (dueDate !== undefined) next.due_date = dueDate;
  return next;
}

/** Same array when no row matched; never adds, removes or reorders rows. */
function patchRows(rows: Task[], frame: TaskPatchFrame): Task[] {
  let changed = false;
  const next = rows.map((row) => {
    const patched = patchRow(row, frame);
    if (patched !== row) changed = true;
    return patched;
  });
  return changed ? next : rows;
}

type HasTasks = { tasks: Task[] };

const hasTasks = (value: unknown): value is HasTasks =>
  typeof value === "object" && value !== null && Array.isArray((value as HasTasks).tasks);

/** A `TaskQueryPage` or a `TaskGroup`: only the page holding the task is copied. */
function patchTasksHolder<T extends HasTasks>(holder: T, frame: TaskPatchFrame): T {
  const tasks = patchRows(holder.tasks, frame);
  return tasks === holder.tasks ? holder : { ...holder, tasks };
}

function patchHolders(holders: unknown[], frame: TaskPatchFrame): unknown[] {
  let changed = false;
  const next = holders.map((holder) => {
    if (!hasTasks(holder)) return holder;
    const patched = patchTasksHolder(holder, frame);
    if (patched !== holder) changed = true;
    return patched;
  });
  return changed ? next : holders;
}

/**
 * Entries under `queryRoot` and `myTasks`: a plain `TaskQueryPage` (3-segment
 * key) or an infinite `{ pages, pageParams }` (4-segment key). Data may be
 * `undefined` for an entry that has not loaded.
 */
function patchQueryEntry(data: unknown, frame: TaskPatchFrame): unknown {
  if (typeof data !== "object" || data === null) return data;
  if ("pages" in data) {
    const infinite = data as { pages: unknown };
    if (!Array.isArray(infinite.pages)) return data;
    const pages = patchHolders(infinite.pages, frame);
    return pages === infinite.pages ? data : { ...infinite, pages };
  }
  return hasTasks(data) ? patchTasksHolder(data, frame) : data;
}

type TableRows = { rows: { task: Task }[] };

function patchTableRowsEntry(data: unknown, frame: TaskPatchFrame): unknown {
  const entry = data as TableRows | undefined;
  if (typeof entry !== "object" || entry === null || !Array.isArray(entry.rows)) return data;
  let changed = false;
  const rows = entry.rows.map((row) => {
    if (typeof row !== "object" || row === null || !row.task) return row;
    const task = patchRow(row.task, frame);
    if (task === row.task) return row;
    changed = true;
    return { ...row, task };
  });
  return changed ? { ...entry, rows } : data;
}

/** Rewrite every entry under `root` whose patch changed it; leave the rest untouched. */
function patchEntries(
  qc: QueryClient,
  root: QueryKey,
  patchEntry: (data: unknown, frame: TaskPatchFrame) => unknown,
  frame: TaskPatchFrame,
) {
  for (const [key, data] of qc.getQueriesData<unknown>({ queryKey: root })) {
    const next = patchEntry(data, frame);
    if (next !== data) qc.setQueryData<unknown>(key, next);
  }
}

function patchDetail(qc: QueryClient, frame: TaskPatchFrame): boolean {
  const key = taskKeys.detail(frame.taskId);
  const state = qc.getQueryState<Task | null>(key);
  const cached = state?.data;
  if (
    !state ||
    !cached ||
    // A fetch that started before this change committed would land after the
    // patch with older data; an invalidated entry already awaits a refetch.
    // Either way the detail key must stay in this frame's invalidation.
    state.fetchStatus !== "idle" ||
    state.isInvalidated
  ) {
    return false;
  }
  const next = patchRow(cached, frame);
  if (next === cached) return false;
  qc.setQueryData<Task | null>(key, next);
  return true;
}

/**
 * Patch every cached record of the task that sits at the frame's
 * `revision_before`: the detail entry (`taskKeys.detail`) and the task's rows
 * in `list`, the `queryRoot` and `myTasks` entries (plain pages and infinite
 * `{ pages }`), `grouped` and `tableRows`. A record at any other revision is
 * left alone; no entry or row is ever added, and rows never move between
 * groups, columns or pages — order and grouping come back with the list
 * refetch the caller still schedules. Returns whether the detail entry was
 * patched: only then may the caller skip this frame's detail invalidation.
 */
export function applyTaskPatchFrame(
  qc: QueryClient,
  wsId: string,
  frame: TaskPatchFrame,
): { detailPatched: boolean } {
  patchEntries(qc, taskKeys.list(wsId), (data, f) => (Array.isArray(data) ? patchRows(data, f) : data), frame);
  patchEntries(qc, taskKeys.queryRoot(wsId), patchQueryEntry, frame);
  patchEntries(qc, taskKeys.myTasks(wsId), patchQueryEntry, frame);
  patchEntries(qc, taskKeys.groupedRoot(wsId), (data, f) => (Array.isArray(data) ? patchHolders(data, f) : data), frame);
  // Row entries only (`tableRows` minus its hash): groups and facets hold no task records.
  patchEntries(qc, taskKeys.tableRows(wsId, "").slice(0, -1), patchTableRowsEntry, frame);
  return { detailPatched: patchDetail(qc, frame) };
}
