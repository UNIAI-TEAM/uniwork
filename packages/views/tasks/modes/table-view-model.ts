import type { TableGroupValue, TableRowLabel } from "@uniwork/core/api/endpoints/tasks-table";
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
      /** The row's labels, as the rows API paged them — no per-row fetch. */
      labels: TableRowLabel[];
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
