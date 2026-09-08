"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table";
import type {
  SortDirection,
  SortField,
  TableColumnKey,
  TableSystemColumnKey,
} from "@uniwork/core/tasks/stores/view-store";
import { propertyIdFromViewKey } from "@uniwork/core/tasks/stores/view-store";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { AgentBadge } from "../../agents/agent-badge";
import { InlineTitle } from "./table-inline-title";
import type { TaskTableDisplayRow } from "./table-view-model";

export type TableViewMeta = {
  visibleTaskIds: string[];
  editingDisabled: boolean;
  editingDisabledReason?: string;
  columnLabel: (key: TableColumnKey) => string;
  sortBy: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField, direction: SortDirection) => void;
  handleTaskSelection: (taskId: string, shiftKey: boolean) => void;
  selectAllVisible: () => void;
  clearVisibleSelection: () => void;
  toggleParentCollapsed: (taskId: string) => void;
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

function stopRowNavigation(event: React.SyntheticEvent) {
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
  const meta = getTableViewMeta(table);
  const sortField = !propertyIdFromViewKey(columnKey)
    ? SORTABLE_COLUMNS[columnKey as TableSystemColumnKey]
    : undefined;
  const active = sortField && meta.sortBy === sortField;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1 text-left text-caption font-medium",
        sortField ? "hover:text-foreground" : "cursor-default",
      )}
      disabled={!sortField}
      onClick={() => {
        if (!sortField) return;
        const next: SortDirection =
          active && meta.sortDirection === "asc" ? "desc" : "asc";
        meta.onSort(sortField, next);
      }}
    >
      <span className="truncate">{meta.columnLabel(columnKey)}</span>
      {active ? (
        <span className="text-muted-foreground" aria-hidden>
          {meta.sortDirection === "asc" ? "↑" : "↓"}
        </span>
      ) : null}
    </button>
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
          title={task.title}
          depth={row.depth}
          hasChildren={row.hasChildren}
          collapsed={row.collapsed}
          onToggleChildren={() => meta.toggleParentCollapsed(task.id)}
          editingDisabled={meta.editingDisabled}
          editingDisabledReason={meta.editingDisabledReason}
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
        <span className="text-caption">
          {t(`tasks.status_${task.status}`, { defaultValue: task.status })}
        </span>
      );
    case "priority":
      return (
        <span className="text-caption">
          {t(`tasks.priority_${task.priority}`, {
            defaultValue: task.priority,
          })}
        </span>
      );
    case "assignee":
      return (
        <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
          {task.assignee?.display_name ?? t("tasks.unassigned")}
          {task.assignee?.kind === "agent" ? <AgentBadge /> : null}
        </span>
      );
    case "due_date":
      return (
        <span className="text-caption text-muted-foreground">
          {task.due_date ?? "—"}
        </span>
      );
    case "created_at":
    case "updated_at":
      return (
        <span className="text-caption text-muted-foreground">
          {task[columnKey] ?? "—"}
        </span>
      );
    case "creator":
      return (
        <span className="text-caption text-muted-foreground">
          {task.created_by}
        </span>
      );
    case "labels":
    case "project":
    case "start_date":
    case "child_progress":
      return (
        <span
          className="text-caption text-muted-foreground"
          title={meta.editingDisabledReason ?? t("capabilities.unknown")}
        >
          {t("tasks.table.unavailable_cell")}
        </span>
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

    return [selectCol, ...dataCols];
  }, [columnKeys]);
}
