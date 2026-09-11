"use client";

import {
  useMemo,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, EyeOff, Plus } from "lucide-react";
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table";
import type {
  SortDirection,
  SortField,
  TableColumnKey,
  TableSystemColumnKey,
} from "@uniwork/core/tasks/stores/view-store";
import type { TaskLabel } from "@uniwork/core/types";
import { propertyIdFromViewKey } from "@uniwork/core/tasks/stores/view-store";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { InlineTitle } from "./table-inline-title";
import {
  TableAssigneeCell,
  TableDateText,
  TableDueDateCell,
  TableLabelsCell,
  TablePriorityCell,
  TableProgressCell,
  TableProjectCell,
  TableStatusCell,
  type TableMember,
} from "./table-cell-editors";
import type { TaskTableDisplayRow } from "./table-view-model";
import { TableColumnPicker } from "./table-column-picker";

export type TableViewMeta = {
  visibleTaskIds: string[];
  editingDisabled: boolean;
  editingDisabledReason?: string;
  hierarchyDisabled: boolean;
  workspaceId: string;
  members: TableMember[];
  labels: TaskLabel[];
  projectNames: ReadonlyMap<string, string>;
  childProgress: ReadonlyMap<string, { done: number; total: number }>;
  columnLabel: (key: TableColumnKey) => string;
  sortBy: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField, direction: SortDirection) => void;
  handleTaskSelection: (taskId: string, shiftKey: boolean) => void;
  selectAllVisible: () => void;
  clearVisibleSelection: () => void;
  updateTask: (taskId: string, updates: Record<string, unknown>) => void;
  toggleTableParentCollapsed: (taskId: string) => void;
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

const SORTABLE_COLUMNS: Partial<Record<TableSystemColumnKey, SortField>> = {
  title: "title",
  status: "status",
  priority: "priority",
  due_date: "due_date",
  created_at: "created_at",
  updated_at: "updated_at",
};

function stopRowNavigation(event: SyntheticEvent) {
  event.stopPropagation();
}

function SelectHeader({
  table,
}: {
  table: TanstackTable<TaskTableDisplayRow>;
}) {
  const { t } = useTranslation();
  const meta = getTableViewMeta(table);
  const ids = meta.visibleTaskIds;
  const selectedCount = ids.filter((id) => meta.selectedIds.has(id)).length;
  const checked = ids.length > 0 && selectedCount === ids.length;
  const indeterminate = selectedCount > 0 && selectedCount < ids.length;

  return (
    <input
      type="checkbox"
      className="size-4 accent-primary"
      checked={checked}
      ref={(node) => {
        if (node) node.indeterminate = indeterminate;
      }}
      aria-label={t("tasks.table.select_all")}
      onChange={() => {
        if (checked) meta.clearVisibleSelection();
        else meta.selectAllVisible();
      }}
      onClick={stopRowNavigation}
    />
  );
}

function SelectCell({
  row,
  table,
}: {
  row: Extract<TaskTableDisplayRow, { kind: "task" }>;
  table: TanstackTable<TaskTableDisplayRow>;
}) {
  const { t } = useTranslation();
  const meta = getTableViewMeta(table);
  return (
    <input
      type="checkbox"
      className="size-4 accent-primary"
      checked={meta.selectedIds.has(row.task.id)}
      aria-label={t("tasks.table.select_row")}
      onChange={(event) => {
        const native = event.nativeEvent as MouseEvent;
        meta.handleTaskSelection(row.task.id, native.shiftKey);
      }}
      onClick={stopRowNavigation}
    />
  );
}

function HeaderLabel({
  columnKey,
  table,
}: {
  columnKey: TableColumnKey;
  table: TanstackTable<TaskTableDisplayRow>;
}) {
  const { t } = useTranslation();
  const meta = getTableViewMeta(table);
  const sortField = !propertyIdFromViewKey(columnKey)
    ? SORTABLE_COLUMNS[columnKey as TableSystemColumnKey]
    : undefined;
  const active = sortField && meta.sortBy === sortField;
  return (
    <div className="-mx-4 -my-2 flex h-[calc(100%+1rem)] min-w-0 items-center px-4">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-accent">
          <span className="truncate">{meta.columnLabel(columnKey)}</span>
          {active ? (
            meta.sortDirection === "asc" ? (
              <ArrowUp className="size-3 shrink-0" aria-hidden />
            ) : (
              <ArrowDown className="size-3 shrink-0" aria-hidden />
            )
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {sortField ? (
            <>
              <DropdownMenuItem onClick={() => meta.onSort(sortField, "asc")}>
                <ArrowUp aria-hidden />
                {t("tasks.table.sort_ascending")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => meta.onSort(sortField, "desc")}>
                <ArrowDown aria-hidden />
                {t("tasks.table.sort_descending")}
              </DropdownMenuItem>
            </>
          ) : null}
          {sortField && columnKey !== "title" ? <DropdownMenuSeparator /> : null}
          {columnKey !== "title" ? (
            <DropdownMenuItem onClick={() => meta.toggleTableColumn(columnKey)}>
              <EyeOff aria-hidden />
              {t("tasks.table.columns.hide")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AddColumnHeader({
  table,
}: {
  table: TanstackTable<TaskTableDisplayRow>;
}) {
  const { t } = useTranslation();
  const meta = getTableViewMeta(table);
  return (
    <TableColumnPicker
      propertiesDisabled={meta.propertiesDisabled}
      propertiesDisabledReason={meta.propertiesDisabledReason}
      trigger={
        <button
          type="button"
          aria-label={t("tasks.table.columns.add")}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      }
    />
  );
}

function TaskCellContent({
  columnKey,
  row,
  table,
}: {
  columnKey: TableColumnKey;
  row: Extract<TaskTableDisplayRow, { kind: "task" }>;
  table: TanstackTable<TaskTableDisplayRow>;
}): ReactNode {
  const { t } = useTranslation();
  const meta = getTableViewMeta(table);
  const task = row.task;

  switch (columnKey) {
    case "title":
      return (
        <InlineTitle
          identifier={task.identifier}
          title={task.title}
          depth={row.depth}
          hasChildren={row.hasChildren}
          collapsed={row.collapsed}
          hierarchyDisabled={meta.hierarchyDisabled}
          editingDisabled={meta.editingDisabled}
          editingDisabledReason={meta.editingDisabledReason}
          onToggleChildren={() => meta.toggleTableParentCollapsed(task.id)}
          onCommit={(title) => meta.updateTask(task.id, { title })}
        />
      );
    case "identifier":
      return (
        <span className="text-caption text-muted-foreground">
          {task.identifier || "—"}
        </span>
      );
    case "status":
      return (
        <TableStatusCell
          value={task.status}
          onChange={(status) => meta.updateTask(task.id, { status })}
        />
      );
    case "priority":
      return (
        <TablePriorityCell
          value={task.priority}
          onChange={(priority) => meta.updateTask(task.id, { priority })}
        />
      );
    case "assignee":
      return (
        <TableAssigneeCell
          assigneeId={task.assignee_id}
          assigneeName={task.assignee?.display_name}
          assigneeKind={task.assignee?.kind ?? task.assignee_kind}
          members={meta.members}
          onChange={(assigneeId) =>
            meta.updateTask(task.id, {
              assignee_id: assigneeId,
              assignee_kind: "human",
            })
          }
        />
      );
    case "due_date":
      return (
        <TableDueDateCell
          value={task.due_date}
          onChange={(dueDate) =>
            meta.updateTask(task.id, { due_date: dueDate })
          }
        />
      );
    case "created_at":
    case "updated_at":
      return <TableDateText value={task[columnKey]} />;
    case "creator": {
      const creator = meta.members.find(
        (member) => member.id === task.created_by,
      );
      return (
        <span className="text-caption text-muted-foreground">
          {creator?.name ?? task.created_by}
        </span>
      );
    }
    case "project":
      return (
        <TableProjectCell
          title={
            task.project_id
              ? meta.projectNames.get(task.project_id)
              : undefined
          }
        />
      );
    case "start_date":
      return <TableDateText value={task.start_date} />;
    case "child_progress": {
      const progress = meta.childProgress.get(task.id);
      return (
        <TableProgressCell done={progress?.done} total={progress?.total} />
      );
    }
    case "labels":
      return (
        <TableLabelsCell
          workspaceId={meta.workspaceId}
          taskId={task.id}
          labels={meta.labels}
        />
      );
    default:
      return (
        <span className="text-caption text-muted-foreground">
          {t("tasks.table.unavailable_cell")}
        </span>
      );
  }
}

export function useTableColumnDefs(
  columnKeys: TableColumnKey[],
): ColumnDef<TaskTableDisplayRow>[] {
  return useMemo(() => {
    const selectCol: ColumnDef<TaskTableDisplayRow> = {
      id: "__select",
      size: 40,
      enableResizing: false,
      header: ({ table }) => <SelectHeader table={table} />,
      cell: ({ row, table }) => {
        if (row.original.kind === "skeleton") {
          return <Skeleton className="size-4 rounded" />;
        }
        if (row.original.kind !== "task") return null;
        return <SelectCell row={row.original} table={table} />;
      },
    };

    const dataCols: ColumnDef<TaskTableDisplayRow>[] = columnKeys.map(
      (columnKey) => ({
        id: columnKey,
        accessorFn: () => columnKey,
        size: columnKey === "title" ? 360 : 140,
        minSize: 80,
        header: ({ table }) => (
          <HeaderLabel columnKey={columnKey} table={table} />
        ),
        cell: ({ row, table }) => {
          if (row.original.kind === "skeleton") {
            return <Skeleton className="h-4 w-3/4" />;
          }
          if (row.original.kind !== "task") return null;
          return (
            <TaskCellContent
              columnKey={columnKey}
              row={row.original}
              table={table}
            />
          );
        },
        meta: {
          grow: columnKey === "title",
        },
      }),
    );

    const addColumn: ColumnDef<TaskTableDisplayRow> = {
      id: "__add",
      size: 48,
      minSize: 48,
      maxSize: 48,
      enableResizing: false,
      header: ({ table }) => <AddColumnHeader table={table} />,
      cell: () => null,
    };

    return [selectCol, ...dataCols, addColumn];
  }, [columnKeys]);
}
