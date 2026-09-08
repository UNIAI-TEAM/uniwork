"use client";

import type {
  TaskPriority,
  TaskStatusCategory,
} from "../../types/task";

/** Catalog category key, or a custom status key the workspace defined. */
export type TaskStatusKey = TaskStatusCategory | (string & {});

export type TaskViewMode = "board" | "list" | "table" | "gantt" | "swimlane";
export type GanttZoom = "day" | "week" | "month";

/**
 * Board grouping. Besides the three built-ins, a select-type custom property
 * groups columns by its options via the `property:<definitionId>` form.
 * Persisted values may reference a since-archived definition — consumers must
 * fall back to "status" when the definition can't be resolved.
 */
export type TaskGrouping =
  | "status"
  | "assignee"
  | "project"
  | `property:${string}`;
export type SwimlaneGrouping = "parent" | "project" | "assignee";

/**
 * Sort key. `property:<definitionId>` is resolved server-side against the
 * active property catalog; stale or unsupported definitions degrade to
 * position order.
 */
export type SortField =
  | "position"
  | "status"
  | "priority"
  | "start_date"
  | "due_date"
  | "created_at"
  | "updated_at"
  | "title"
  | `property:${string}`;
export type SortDirection = "asc" | "desc";
export type TaskDateField = "created_at" | "updated_at";

export type TableSystemColumnKey =
  | "title"
  | "identifier"
  | "status"
  | "priority"
  | "assignee"
  | "labels"
  | "project"
  | "start_date"
  | "due_date"
  | "created_at"
  | "updated_at"
  | "child_progress"
  | "creator";
export type TableColumnKey = TableSystemColumnKey | `property:${string}`;
export interface TableColumnConfig {
  key: TableColumnKey;
  width?: number;
}
export type TableGrouping =
  | "none"
  | "status"
  | "assignee"
  | "project"
  | `property:${string}`;
export type TableCalculation = "none" | "sum" | "average" | "count";

export const TABLE_SYSTEM_COLUMNS: readonly TableSystemColumnKey[] = [
  "title",
  "identifier",
  "status",
  "priority",
  "assignee",
  "labels",
  "project",
  "start_date",
  "due_date",
  "created_at",
  "updated_at",
  "child_progress",
  "creator",
];

export const DEFAULT_TABLE_COLUMNS: readonly TableColumnConfig[] = [
  { key: "title", width: 360 },
  { key: "status", width: 150 },
  { key: "priority", width: 130 },
  { key: "assignee", width: 180 },
  { key: "due_date", width: 140 },
  { key: "labels", width: 220 },
];

export interface TaskDateFilter {
  field: TaskDateField;
  from: string;
  to: string;
}

export const SWIMLANE_GROUPINGS: SwimlaneGrouping[] = [
  "parent",
  "project",
  "assignee",
];

export interface CardProperties {
  priority: boolean;
  description: boolean;
  assignee: boolean;
  startDate: boolean;
  dueDate: boolean;
  project: boolean;
  childProgress: boolean;
  labels: boolean;
}

export interface ActorFilterValue {
  type: "member" | "agent" | "squad";
  id: string;
}

/** The nine query-defining filter fields as one value — what a saved view
 *  fixes, and what resets restore. */
export interface FilterSnapshot {
  statusFilters: TaskStatusKey[];
  priorityFilters: TaskPriority[];
  assigneeFilters: ActorFilterValue[];
  includeNoAssignee: boolean;
  creatorFilters: ActorFilterValue[];
  projectFilters: string[];
  includeNoProject: boolean;
  labelFilters: string[];
  propertyFilters: Record<string, string[]>;
}

/** Filter-bar chip dimensions. Date is excluded: `dateFilter` lives outside
 *  the persisted slice and clears through `setDateFilter(null)`. */
export type FilterDimension =
  | "status"
  | "priority"
  | "assignee"
  | "creator"
  | "project"
  | "label"
  | `property:${string}`;

export const PROPERTY_VIEW_PREFIX = "property:";

export function propertyIdFromViewKey(key: string): string | null {
  return key.startsWith(PROPERTY_VIEW_PREFIX)
    ? key.slice(PROPERTY_VIEW_PREFIX.length)
    : null;
}

export type StaticSortField = Exclude<SortField, `property:${string}`>;
export type StaticTaskGrouping = Exclude<TaskGrouping, `property:${string}`>;

export const SORT_OPTIONS: { value: StaticSortField; label: string }[] = [
  { value: "position", label: "Manual" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "start_date", label: "Start date" },
  { value: "due_date", label: "Due date" },
  { value: "created_at", label: "Created date" },
  { value: "updated_at", label: "Updated date" },
  { value: "title", label: "Title" },
];

export const GROUPING_OPTIONS: { value: StaticTaskGrouping; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "assignee", label: "Assignee" },
  { value: "project", label: "Project" },
];

export const CARD_PROPERTY_OPTIONS: {
  key: keyof CardProperties;
  label: string;
}[] = [
  { key: "priority", label: "Priority" },
  { key: "description", label: "Description" },
  { key: "assignee", label: "Assignee" },
  { key: "startDate", label: "Start date" },
  { key: "dueDate", label: "Due date" },
  { key: "project", label: "Project" },
  { key: "labels", label: "Labels" },
  { key: "childProgress", label: "Sub-task progress" },
];

export type { TaskPriority, TaskStatusCategory };
