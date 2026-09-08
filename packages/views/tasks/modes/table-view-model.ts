import {
  propertyIdFromViewKey,
  type SortDirection,
  type SortField,
  type TableCalculation,
  type TableColumnKey,
} from "@uniwork/core/tasks/stores/view-store";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
} from "@uniwork/core/types";

/** Export must fail closed when paged table responses cannot prove the full
 * query window was collected. The UI translates this marker. */
export class TaskTableExportIntegrityError extends Error {
  constructor() {
    super("Table export response was incomplete");
    this.name = "TaskTableExportIntegrityError";
  }
}

export type TaskTableDisplayRow =
  | {
      kind: "group";
      key: string;
      label: string;
      count: number;
      collapsed: boolean;
    }
  | {
      kind: "task";
      key: string;
      task: Task;
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
    }
  | { kind: "skeleton"; key: string }
  | {
      kind: "load_more";
      key: string;
      state: "loading" | "has_more" | "error" | "end";
      total: number;
      loadedCount: number;
      onLoad?: () => void;
    };

export type TaskTableFacetKind =
  | "status"
  | "priority"
  | "assignee"
  | "creator"
  | "project"
  | "label";

export type TaskTableFacetSpec = { kind: TaskTableFacetKind };

export function getTaskTableSelectionRange(
  taskIds: string[],
  anchorId: string | null,
  targetId: string,
): string[] | null {
  if (!anchorId) return null;
  const anchorIndex = taskIds.indexOf(anchorId);
  const targetIndex = taskIds.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) return null;

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return taskIds.slice(start, end + 1);
}

/**
 * Refresh task objects inside a frozen row snapshot while a cell editor is
 * open — structure stays put; values stay live.
 */
export function refreshFrozenTableRows(
  snapshot: TaskTableDisplayRow[],
  taskById: ReadonlyMap<string, Task>,
): TaskTableDisplayRow[] {
  return snapshot.map((row) => {
    if (row.kind !== "task") return row;
    const live = taskById.get(row.task.id);
    return live && live !== row.task ? { ...row, task: live } : row;
  });
}

function columnValue(
  task: Task,
  columnKey: TableColumnKey,
): string | number | null | undefined {
  const propertyId = propertyIdFromViewKey(columnKey);
  if (propertyId) return undefined;
  switch (columnKey) {
    case "identifier":
      return task.identifier;
    case "title":
      return task.title;
    case "status":
      return task.status;
    case "priority":
      return task.priority;
    case "assignee":
      return task.assignee_id;
    case "labels":
      return undefined;
    case "project":
      return undefined;
    case "start_date":
      return undefined;
    case "due_date":
      return task.due_date;
    case "created_at":
      return task.created_at;
    case "updated_at":
      return task.updated_at;
    case "child_progress":
      return undefined;
    case "creator":
      return task.created_by;
    default:
      return undefined;
  }
}

export function calculateTaskTableColumn(
  tasks: Task[],
  columnKey: TableColumnKey,
  calculation: TableCalculation,
) {
  if (calculation === "none") return null;
  const values = tasks
    .map((task) => columnValue(task, columnKey))
    .filter((value) => value !== undefined && value !== null && value !== "");
  if (calculation === "count") return values.length;
  const numbers = values.filter(
    (value): value is number => typeof value === "number",
  );
  if (numbers.length === 0) return null;
  const sum = numbers.reduce((total, value) => total + value, 0);
  return calculation === "sum" ? sum : sum / numbers.length;
}

function escapeCsvCell(value: unknown) {
  const raw = value == null ? "" : String(value);
  const text =
    typeof value === "string" && /^[=+\-@\t\r]/.test(raw)
      ? `'${raw}`
      : raw;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildTaskTableCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
}

/** Map view-store grouping to the suite `group_by` string. */
export function tableGroupBy(
  grouping: string,
  opts?: { projectsAvailable?: boolean },
): string {
  if (grouping === "project" && !opts?.projectsAvailable) return "status";
  if (grouping === "none") return "status";
  if (
    grouping === "status" ||
    grouping === "assignee" ||
    grouping === "project"
  ) {
    return grouping;
  }
  // Property grouping stays on status until property catalog lands.
  if (grouping.startsWith("property:")) return "status";
  return "status";
}

export function groupLabelFromDescriptor(
  key: string,
  value: { kind: string; status?: string; priority?: string },
  translateStatus: (status: string) => string,
  translatePriority: (priority: string) => string,
  unassignedLabel: string,
): string {
  if (value.kind === "status" && value.status) {
    return translateStatus(value.status);
  }
  if (value.kind === "priority" && value.priority) {
    return translatePriority(value.priority);
  }
  if (value.kind === "assignee") {
    return key.includes(":") ? key.split(":").slice(1).join(":") : unassignedLabel;
  }
  return key;
}

const STATUS_RANK = new Map(TASK_STATUSES.map((status, i) => [status, i]));
const PRIORITY_RANK = new Map(
  TASK_PRIORITIES.map((priority, i) => [priority, i]),
);

function sortValue(task: Task, field: SortField): string | number | null {
  switch (field) {
    case "title":
      return task.title.toLocaleLowerCase();
    case "status":
      return STATUS_RANK.get(task.status) ?? Number.MAX_SAFE_INTEGER;
    case "priority":
      return PRIORITY_RANK.get(task.priority) ?? Number.MAX_SAFE_INTEGER;
    case "due_date":
      return task.due_date ?? "";
    case "created_at":
      return task.created_at;
    case "updated_at":
      return task.updated_at;
    case "position":
      return task.position;
    case "start_date":
      return task.start_date ?? "";
    default:
      return null;
  }
}

/** Client-sort loaded table rows; unknown / property fields keep input order. */
export function sortTasksForTable(
  tasks: Task[],
  sortBy: SortField,
  sortDirection: SortDirection,
): Task[] {
  const ranked = tasks.map((task, index) => ({
    task,
    index,
    value: sortValue(task, sortBy),
  }));
  const direction = sortDirection === "desc" ? -1 : 1;
  ranked.sort((a, b) => {
    if (a.value == null && b.value == null) return a.index - b.index;
    if (a.value == null || a.value === "") return 1;
    if (b.value == null || b.value === "") return -1;
    if (a.value < b.value) return -1 * direction;
    if (a.value > b.value) return 1 * direction;
    return a.index - b.index;
  });
  return ranked.map((entry) => entry.task);
}

export const TABLE_PAGE_SIZE = 50;
