import type { TableGroupValue } from "@uniwork/core/api/endpoints/tasks-table";
import {
  propertyIdFromViewKey,
  type TableCalculation,
  type TableColumnKey,
} from "@uniwork/core/tasks/stores/view-store";
import type { Task } from "@uniwork/core/types";

export type TaskTableDisplayRow =
  | {
      kind: "group";
      key: string;
      label: string;
      count: number;
      collapsed: boolean;
      /** A property option's stored colour, for a select property's groups. */
      color?: string;
    }
  | {
      kind: "task";
      key: string;
      task: Task;
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
    }
  | { kind: "skeleton"; key: string; depth?: number }
  | {
      kind: "load_more";
      key: string;
      state: "loading" | "has_more" | "error" | "end";
      total: number;
      loadedCount: number;
      /** The depth of the rows it pages; a child branch's control sits under its parent. */
      depth?: number;
      onLoad?: () => void;
    };

type TaskTableFacetKind =
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

export interface GroupLabelSource {
  translateStatus: (status: string) => string;
  translatePriority: (priority: string) => string;
  unassigned: string;
  noProject: string;
  noValue: string;
  checked: string;
  unchecked: string;
  resolveAssignee?: (id: string) => string | undefined;
}

/** A group header's text. Names the server resolved (assignee, project, option) win. */
export function groupLabelFromDescriptor(
  key: string,
  value: TableGroupValue,
  labels: GroupLabelSource,
): string {
  switch (value.kind) {
    case "status":
      return value.status ? labels.translateStatus(value.status) : key;
    case "priority":
      return value.priority ? labels.translatePriority(value.priority) : key;
    case "assignee": {
      // `assignee:none` carries no actor; `assignee:<type>:<id>` does.
      if (value.label) return value.label;
      const id = value.actor?.id;
      return id ? (labels.resolveAssignee?.(id) ?? id) : labels.unassigned;
    }
    case "project":
      return value.label || labels.noProject;
    case "property":
      if (value.option === undefined || value.option === "") return labels.noValue;
      // A checkbox option is "true"/"false" and has no server label.
      if (value.label) return value.label;
      if (value.option === "true") return labels.checked;
      if (value.option === "false") return labels.unchecked;
      return value.option;
    default:
      return key;
  }
}

export const TABLE_PAGE_SIZE = 50;
