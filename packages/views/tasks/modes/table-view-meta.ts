import type { Table as TanstackTable } from "@tanstack/react-table";
import type {
  SortDirection,
  SortField,
  TableColumnKey,
} from "@uniwork/core/tasks/stores/view-store";
import type { Project, TaskLabel, TaskProperty } from "@uniwork/core/types";
import type { AssigneeOption, MemberOption } from "../pickers";
import type { TaskTableDisplayRow } from "./table-view-model";

/** What every table cell and header reads at render time, via TanStack's `meta`. */
export type TableViewMeta = {
  visibleTaskIds: string[];
  editingDisabled: boolean;
  editingDisabledReason?: string;
  hierarchyDisabled: boolean;
  workspaceId: string;
  members: MemberOption[];
  /** Members, then the workspace's agents — the assignee cell's choices. */
  assigneeOptions: AssigneeOption[];
  labels: TaskLabel[];
  projects: Project[];
  /** The property catalog by id, archived properties included. */
  properties: ReadonlyMap<string, TaskProperty>;
  childProgress: ReadonlyMap<string, { done: number; total: number }>;
  columnLabel: (key: TableColumnKey) => string;
  sortBy: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField, direction: SortDirection) => void;
  handleTaskSelection: (taskId: string, shiftKey: boolean) => void;
  selectAllVisible: () => void;
  clearVisibleSelection: () => void;
  updateTask: (taskId: string, updates: Record<string, unknown>) => void;
  setPropertyValue: (taskId: string, propertyId: string, value: unknown) => void;
  clearPropertyValue: (taskId: string, propertyId: string) => void;
  openTask?: (taskId: string) => void;
  toggleTableParentExpanded: (taskId: string) => void;
  toggleTableColumn: (key: TableColumnKey) => void;
  propertiesDisabled: boolean;
  propertiesDisabledReason?: string;
  selectedIds: Set<string>;
};

export function getTableViewMeta(
  table: TanstackTable<TaskTableDisplayRow>,
): TableViewMeta {
  return table.options.meta as unknown as TableViewMeta;
}
