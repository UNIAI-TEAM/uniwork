"use client";

import { useMemo, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table";
import type { TableColumnKey } from "@uniwork/core/tasks/stores/view-store";
import type { Task } from "@uniwork/core/types";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import type { TaskTableDisplayRow } from "./table-view-model";
import { TableColumnPicker } from "./table-column-picker";
import {
  TableHeaderSortMenu,
  sortFieldForColumn,
} from "./table-header-sort-menu";
import { TaskCellContent } from "./table-task-cell";
import { getTableViewMeta } from "./table-view-meta";
import {
  RowActionsDropdown,
  RowDeleteDialog,
  useRowActionModel,
} from "../row-actions-menu";

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
      // Block, not inline: on the baseline the line's descent grows the header row.
      className="block size-4 accent-primary"
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
  return (
    <TableHeaderSortMenu
      columnKey={columnKey}
      label={meta.columnLabel(columnKey)}
      sortField={sortFieldForColumn(columnKey, meta.properties)}
      sortBy={meta.sortBy}
      sortDirection={meta.sortDirection}
      onSort={meta.onSort}
      onHide={meta.toggleTableColumn}
    />
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
      properties={meta.properties}
      propertiesDisabled={meta.propertiesDisabled}
      propertiesDisabledReason={meta.propertiesDisabledReason}
      trigger={
        <button
          type="button"
          aria-label={t("tasks.table.columns.add")}
          // Block-level (flex): an inline-block sits on the text baseline and
          // the line's descent grows the header row. -my-1 keeps the 22px
          // button to the 16px content box, overflowing into the cell's
          // unclipped py-2.
          className="-my-1 flex rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      }
    />
  );
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
            // A child branch's placeholder sits at its depth, like its rows will.
            const depth = columnKey === "title" ? (row.original.depth ?? 0) : 0;
            return (
              <div style={depth ? { paddingLeft: depth * 16 } : undefined}>
                <Skeleton className="h-4 w-3/4" />
              </div>
            );
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
      // Row actions sit in the fixed trailing column: no new column key, and
      // the cell is already outside every editable cell. The table gets only
      // the dropdown; see task-5 report for why there is no context menu here.
      cell: ({ row, table }) => {
        if (row.original.kind !== "task") return null;
        return (
          <TableRowActions
            task={row.original.task}
            onOpenTask={getTableViewMeta(table).openTask}
          />
        );
      },
    };

    return [selectCol, ...dataCols, addColumn];
  }, [columnKeys]);
}

/** The table row's actions cell: one model, its dropdown and its one dialog. */
function TableRowActions({
  task,
  onOpenTask,
}: {
  task: Task;
  onOpenTask?: (id: string) => void;
}) {
  const rowActions = useRowActionModel(task, onOpenTask);
  return (
    <>
      <RowActionsDropdown
        model={rowActions}
        className="-mx-4 justify-center"
        triggerClassName="group-hover:opacity-100 group-focus-within:opacity-100"
      />
      <RowDeleteDialog model={rowActions} />
    </>
  );
}
