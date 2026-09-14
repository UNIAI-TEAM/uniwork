import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Task } from "../types/task";
import { taskKeys } from "./keys";

/**
 * Client copy of the `Patch` list on the `task.updated` row of
 * server/internal/outbox/catalogue.go (ADR 0015), and the only list of Patch
 * fields in this module: the decoder iterates it and `TaskPatchFields` is
 * derived from it. scripts/events-catalogue.test.mjs reads this declaration
 * and fails when the two lists differ: a server field missing here would make
 * every frame carrying it fall back to a refetch (`FRAME_KEYS`).
 */
const TASK_PATCH_FIELDS = ["title", "status", "priority", "due_date"] as const;

/**
 * Every key a frame this bundle patches may carry. Frames carry no event
 * version, so a key outside this set, such as a field a later ADR adds to
 * Patch, is the only sign the server is ahead of the bundle. Such a frame is
 * ids-only: patching the fields known here and taking the revision would
 * leave that field stale behind a current revision.
 */
const FRAME_KEYS: ReadonlySet<string> = new Set([
  "task_id",
  "workspace_id",
  "revision_before",
  "revision",
  ...TASK_PATCH_FIELDS,
]);

/** One optional key per `TASK_PATCH_FIELDS` entry; `due_date` is `null` when the frame cleared the date (the server sends ""). */
type TaskPatchFields = {
  [Field in (typeof TASK_PATCH_FIELDS)[number]]?: Field extends "due_date" ? string | null : string;
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
 * missing or malformed revision, `revision <= revision_before`, a key outside
 * `FRAME_KEYS`, or no Patch field at all. A Patch field that cannot be applied
 * (not a string, a date not `YYYY-MM-DD`) rejects the whole frame too:
 * dropping it and still taking the revision would leave that field stale
 * behind a current revision.
 */
export function parseTaskPatchFrame(payload: Readonly<Record<string, unknown>>): TaskPatchFrame | null {
  const taskId = payload.task_id;
  if (typeof taskId !== "string" || taskId === "") return null;
  const revisionBefore = parseRevision(payload.revision_before);
  const revision = parseRevision(payload.revision);
  if (revisionBefore === null || revision === null || revision <= revisionBefore) return null;
  if (Object.keys(payload).some((key) => !FRAME_KEYS.has(key))) return null;

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

/** A `TaskQueryPage`: only the page holding the task is copied. */
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

/**
 * Rewrite every entry under `root` whose patch changed it; leave the rest
 * untouched. An idle entry that an earlier wave already invalidated is skipped:
 * `setQueryData` would clear its `isInvalidated` and restamp it, so if this
 * frame's own wave were then lost (the scheduler disposed inside its debounce)
 * the entry would read as fresh for the whole `staleTime`. Left alone, it
 * refetches on mount. A fetching entry is still patched: whatever that fetch
 * lands replaces the patch, and this frame's wave invalidates the root anyway.
 */
function patchEntries(
  qc: QueryClient,
  root: QueryKey,
  patchEntry: (data: unknown, frame: TaskPatchFrame) => unknown,
  frame: TaskPatchFrame,
) {
  const entries = qc.getQueriesData<unknown>({
    queryKey: root,
    predicate: ({ state }) => !(state.fetchStatus === "idle" && state.isInvalidated),
  });
  for (const [key, data] of entries) {
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
 * `{ pages }`) and `tableRows`. A record at any other revision is left alone,
 * and so is an entry already due a refetch (`patchDetail`, `patchEntries`); no
 * entry or row is ever added, and rows never move between groups, columns or
 * pages — order comes back with the list refetch the caller still schedules.
 * Returns whether the detail entry was patched: only then may the caller skip
 * this frame's detail invalidation.
 */
export function applyTaskPatchFrame(
  qc: QueryClient,
  wsId: string,
  frame: TaskPatchFrame,
): { detailPatched: boolean } {
  patchEntries(qc, taskKeys.list(wsId), (data, f) => (Array.isArray(data) ? patchRows(data, f) : data), frame);
  patchEntries(qc, taskKeys.queryRoot(wsId), patchQueryEntry, frame);
  patchEntries(qc, taskKeys.myTasks(wsId), patchQueryEntry, frame);
  // Row entries only (`tableRows` minus its hash): groups and facets hold no task records.
  patchEntries(qc, taskKeys.tableRows(wsId, "").slice(0, -1), patchTableRowsEntry, frame);
  return { detailPatched: patchDetail(qc, frame) };
}
