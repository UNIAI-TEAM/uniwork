"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnSizingState,
} from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import type { TableFilter } from "@uniwork/core/api/endpoints/tasks-table";
import {
  propertyIdFromViewKey,
  type SortDirection,
  type SortField,
  type TableColumnKey,
} from "@uniwork/core/tasks/stores/view-store";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { DataTable } from "@uniwork/ui/components/ui/data-table";
import { useTaskSurfaceSelection } from "../surface/selection-context";
import { TaskTableGroupRow } from "./table-group-row";
import { TaskTableLoadMoreRow } from "./table-load-more-row";
import {
  useTableColumnDefs,
  type TableViewMeta,
} from "./table-view-columns";
import { TableViewToolbar } from "./table-view-toolbar";
import {
  getTaskTableSelectionRange,
  type TaskTableDisplayRow,
} from "./table-view-model";
import { useTableViewData } from "./use-table-view-data";

/**
 * Suite TaskSurface table mode — baseline table structure (groups, rows,
 * DataTable, column picker, selection) on suite table APIs.
 *
 * Deep property editors, Projects grouping, and AgentRun chrome stay
 * visible-disabled until those capabilities ship.
 */
export function TableView({
  workspaceId,
  filter,
  projectGroupingDisabled = true,
  projectGroupingReasonKey = "capabilities.unknown",
  propertiesDisabled = true,
  propertiesDisabledReasonKey = "capabilities.unknown",
  editingDisabled = true,
  editingDisabledReasonKey = "capabilities.unknown",
  onOpenTask,
}: {
  workspaceId: string;
  filter?: TableFilter;
  projectGroupingDisabled?: boolean;
  projectGroupingReasonKey?: string;
  propertiesDisabled?: boolean;
  propertiesDisabledReasonKey?: string;
  editingDisabled?: boolean;
  editingDisabledReasonKey?: string;
  onOpenTask?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const selection = useTaskSurfaceSelection();
  const selectionAnchorRef = useRef<string | null>(null);
  const [search, setSearch] = useState("");

  const tableColumns = useViewStore((s) => s.tableColumns);
  const setTableColumnWidth = useViewStore((s) => s.setTableColumnWidth);
  const toggleTableGroupCollapsed = useViewStore(
    (s) => s.toggleTableGroupCollapsed,
  );
  const sortBy = useViewStore((s) => s.sortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);
  const setSortBy = useViewStore((s) => s.setSortBy);
  const setSortDirection = useViewStore((s) => s.setSortDirection);

  const data = useTableViewData({
    workspaceId,
    filter,
    projectsAvailable: !projectGroupingDisabled,
    search,
  });

  const columnKeys = useMemo(
    () =>
      tableColumns
        .map((column) => column.key)
        .filter((key) => !propertyIdFromViewKey(key)),
    [tableColumns],
  );

  const columns = useTableColumnDefs(columnKeys);

  const visibleTaskIds = useMemo(
    () =>
      data.displayRows
        .filter(
          (row): row is Extract<TaskTableDisplayRow, { kind: "task" }> =>
            row.kind === "task",
        )
        .map((row) => row.task.id),
    [data.displayRows],
  );

  const handleTaskSelection = useCallback(
    (taskId: string, shiftKey: boolean) => {
      const range = shiftKey
        ? getTaskTableSelectionRange(
            visibleTaskIds,
            selectionAnchorRef.current,
            taskId,
          )
        : null;
      if (range) {
        if (selection.selectedIds.has(taskId)) selection.deselect(range);
        else selection.select(range);
        return;
      }
      selection.toggle(taskId);
      selectionAnchorRef.current = taskId;
    },
    [selection, visibleTaskIds],
  );

  const selectAllVisible = useCallback(() => {
    selection.select(visibleTaskIds);
  }, [selection, visibleTaskIds]);

  const clearVisibleSelection = useCallback(() => {
    selection.deselect(visibleTaskIds);
  }, [selection, visibleTaskIds]);

  const columnLabel = useCallback(
    (key: TableColumnKey) => {
      const propertyId = propertyIdFromViewKey(key);
      if (propertyId) return t("tasks.table.unavailable_cell");
      return t(`tasks.table.columns.${key}`);
    },
    [t],
  );

  const onSort = useCallback(
    (field: SortField, direction: SortDirection) => {
      setSortBy(field);
      setSortDirection(direction);
    },
    [setSortBy, setSortDirection],
  );

  const columnSizing = useMemo(() => {
    const sizing: ColumnSizingState = {};
    for (const column of tableColumns) {
      if (column.width != null) sizing[column.key] = column.width;
    }
    return sizing;
  }, [tableColumns]);

  // Meta is read at cell render time; keep the identity stable unless inputs change.
  const viewMeta: TableViewMeta = useMemo(
    () => ({
      visibleTaskIds,
      editingDisabled,
      editingDisabledReason: t(editingDisabledReasonKey),
      hierarchyDisabled: true,
      hierarchyDisabledReason: t("tasks.table.hierarchy_unavailable"),
      columnLabel,
      sortBy,
      sortDirection,
      onSort,
      handleTaskSelection,
      selectAllVisible,
      clearVisibleSelection,
      selectedIds: selection.selectedIds,
    }),
    [
      clearVisibleSelection,
      columnLabel,
      editingDisabled,
      editingDisabledReasonKey,
      handleTaskSelection,
      onSort,
      selectAllVisible,
      selection.selectedIds,
      sortBy,
      sortDirection,
      t,
      visibleTaskIds,
    ],
  );

  const table = useReactTable({
    data: data.displayRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.key,
    columnResizeMode: "onChange",
    state: { columnSizing },
    onColumnSizingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnSizing) : updater;
      for (const [key, width] of Object.entries(next)) {
        if (key === "__select") continue;
        const prev = columnSizing[key];
        if (prev === width) continue;
        setTableColumnWidth(key as TableColumnKey, width);
      }
    },
    meta: viewMeta,
  });

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="task-table-view"
    >
      <TableViewToolbar
        search={search}
        onSearchChange={setSearch}
        projectGroupingDisabled={projectGroupingDisabled}
        projectGroupingReason={projectGroupingReasonKey}
        propertiesDisabled={propertiesDisabled}
        propertiesDisabledReason={t(propertiesDisabledReasonKey)}
      />
      {data.groupsError ? (
        <div className="flex flex-1 items-center justify-center p-6 text-body text-muted-foreground">
          {t("tasks.table.load_error")}
        </div>
      ) : (
        <DataTable
          table={table}
          className="min-h-0 flex-1"
          virtualizeRows={data.displayRows.length > 40}
          virtualRowHeight={40}
          emptyMessage={t("tasks.table.empty")}
          onRowClick={(row, event) => {
            if (row.original.kind === "group") {
              toggleTableGroupCollapsed(row.original.key);
              return;
            }
            if (row.original.kind !== "task" || !onOpenTask) return;
            if (
              (event.target as HTMLElement).closest(
                "button, input, a, [role='menuitem']",
              )
            ) {
              return;
            }
            onOpenTask(row.original.task.id);
          }}
          renderRow={(row) => {
            if (row.original.kind === "group") {
              return (
                <TaskTableGroupRow
                  group={row.original}
                  colSpan={table.getVisibleLeafColumns().length}
                  onToggle={() => toggleTableGroupCollapsed(row.original.key)}
                />
              );
            }
            if (row.original.kind === "load_more") {
              return (
                <TaskTableLoadMoreRow
                  row={row.original}
                  colSpan={table.getVisibleLeafColumns().length}
                />
              );
            }
            return null;
          }}
        />
      )}
    </div>
  );
}
