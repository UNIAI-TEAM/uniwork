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
import type { Agent, ChildProgress, Project, TaskProperty } from "@uniwork/core/types";
import {
  useSetTaskPropertyValue,
  useTaskLabels,
  useTaskProperties,
  useUnsetTaskPropertyValue,
} from "@uniwork/core/tasks";
import { toastApiError } from "../../toast-api-error";
import { BatchActionToolbar } from "../views/batch-action-toolbar";
import { useTaskSurfaceActionsOptional } from "../surface/actions-context";
import {
  useHasTaskSelection,
  useTaskSurfaceSelectionHandle,
} from "../surface/selection-context";
import { TaskTableGroupRow } from "./table-group-row";
import { TaskTableLoadMoreRow } from "./table-load-more-row";
import { useTableColumnDefs } from "./table-view-columns";
import type { TableViewMeta } from "./table-view-meta";
import { isRowControlTarget } from "./row-navigation";
import { TableViewToolbar, type TablePropertyGrouping } from "./table-view-toolbar";
import { TableEmptyMessage, TableLoadErrorState, TableRefreshingBar } from "./table-view-states";
import {
  getTaskTableSelectionRange,
  type TaskTableDisplayRow,
} from "./table-view-model";
import { useTableViewData } from "./use-table-view-data";
import type { TableMember } from "./table-cell-editors";
import type { AssigneeOption } from "../pickers";

const EMPTY_MEMBERS: TableMember[] = [];
const EMPTY_PROJECTS: Project[] = [];
const EMPTY_CHILD_PROGRESS: ChildProgress[] = [];
const EMPTY_AGENTS: Agent[] = [];
const EMPTY_PROPERTIES: TaskProperty[] = [];
const GROUPABLE_PROPERTY_TYPES = new Set(["select", "checkbox"]);

/**
 * Suite TaskSurface table mode — baseline table structure (groups, rows,
 * DataTable, column picker, selection) on suite table APIs.
 *
 * Groups by status, priority, assignee, project or an active select/checkbox
 * property on the server. Custom-property columns edit in place unless
 * `propertiesDisabled`; the assignee cell offers members and agents.
 */
export function TableView({
  workspaceId,
  filter,
  members = EMPTY_MEMBERS,
  agents = EMPTY_AGENTS,
  projects = EMPTY_PROJECTS,
  childProgress = EMPTY_CHILD_PROGRESS,
  projectGroupingDisabled = false,
  projectGroupingReasonKey = "capabilities.unknown",
  propertiesDisabled = true,
  propertiesDisabledReasonKey = "capabilities.unknown",
  editingDisabled = false,
  editingDisabledReasonKey = "capabilities.unknown",
  onOpenTask,
}: {
  workspaceId: string;
  filter?: TableFilter;
  members?: TableMember[];
  agents?: Agent[];
  projects?: Project[];
  childProgress?: ChildProgress[];
  projectGroupingDisabled?: boolean;
  projectGroupingReasonKey?: string;
  propertiesDisabled?: boolean;
  propertiesDisabledReasonKey?: string;
  editingDisabled?: boolean;
  editingDisabledReasonKey?: string;
  onOpenTask?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const actions = useTaskSurfaceActionsOptional();
  const labelsQuery = useTaskLabels(workspaceId);
  const selection = useTaskSurfaceSelectionHandle();
  const selectionAnchorRef = useRef<string | null>(null);
  const [search, setSearch] = useState("");
  const propertiesQuery = useTaskProperties(workspaceId);
  const { mutate: setPropertyValue } = useSetTaskPropertyValue(workspaceId);
  const { mutate: unsetPropertyValue } = useUnsetTaskPropertyValue(workspaceId);
  const propertyCatalog = propertiesQuery.data?.properties ?? EMPTY_PROPERTIES;

  const tableColumns = useViewStore((s) => s.tableColumns);
  const setTableColumnWidth = useViewStore((s) => s.setTableColumnWidth);
  const toggleTableColumn = useViewStore((s) => s.toggleTableColumn);
  const reorderTableColumn = useViewStore((s) => s.reorderTableColumn);
  const toggleTableGroupCollapsed = useViewStore(
    (s) => s.toggleTableGroupCollapsed,
  );
  const sortBy = useViewStore((s) => s.sortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);
  const setSortBy = useViewStore((s) => s.setSortBy);
  const setSortDirection = useViewStore((s) => s.setSortDirection);
  const showSubTasks = useViewStore((s) => s.showSubTasks);
  const toggleTableParentExpanded = useViewStore(
    (s) => s.toggleTableParentExpanded,
  );

  const propertyGroupings = useMemo<TablePropertyGrouping[]>(
    () =>
      (propertiesQuery.data?.properties ?? [])
        .filter(
          (property) =>
            !property.archived_at && GROUPABLE_PROPERTY_TYPES.has(property.type),
        )
        .map((property) => ({
          value: `property:${property.id}`,
          label: property.name,
        })),
    [propertiesQuery.data?.properties],
  );

  const properties = useMemo(
    () => new Map(propertyCatalog.map((property) => [property.id, property])),
    [propertyCatalog],
  );
  // Mirrors the properties sidebar: members first, then the workspace's agents.
  const assigneeOptions = useMemo<AssigneeOption[]>(
    () => [
      ...members.map((member) => ({
        id: member.id,
        kind: "human" as const,
        name: member.name,
        ...(member.avatarUrl ? { avatarUrl: member.avatarUrl } : {}),
      })),
      ...agents.map((agent) => ({
        id: agent.id,
        kind: "agent" as const,
        name: agent.name,
        ...(agent.avatar_url ? { avatarUrl: agent.avatar_url } : {}),
      })),
    ],
    [agents, members],
  );
  const childProgressByTask = useMemo(
    () =>
      new Map(
        childProgress.map((progress) => [progress.parent_task_id, progress]),
      ),
    [childProgress],
  );
  const assigneeNames = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members],
  );

  const data = useTableViewData({
    workspaceId,
    filter,
    search,
    assigneeNames,
    properties,
  });

  const columnKeys = useMemo(
    () => tableColumns.map((column) => column.key),
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
        if (selection.store.isSelected(taskId)) selection.deselect(range);
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
      if (propertyId) {
        return properties.get(propertyId)?.name ?? t("tasks.table.unavailable_cell");
      }
      return t(`tasks.table.columns.${key}`);
    },
    [properties, t],
  );

  // The title column stays first; every other column moves by its header grip.
  const reorderableColumnIds = useMemo(
    () => columnKeys.filter((key) => key !== "title"),
    [columnKeys],
  );
  const onColumnReorder = useCallback(
    (active: string, over: string) =>
      reorderTableColumn(active as TableColumnKey, over as TableColumnKey),
    [reorderTableColumn],
  );
  const reorderHandleLabel = useCallback(
    (id: string) =>
      t("tasks.table.reorder_column", { name: columnLabel(id as TableColumnKey) }),
    [columnLabel, t],
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
      hierarchyDisabled: !showSubTasks,
      workspaceId,
      members,
      assigneeOptions,
      labels: labelsQuery.data?.labels ?? [],
      projects,
      properties,
      childProgress: childProgressByTask,
      columnLabel,
      sortBy,
      sortDirection,
      onSort,
      handleTaskSelection,
      selectAllVisible,
      clearVisibleSelection,
      updateTask: (taskId, updates) => {
        actions?.updateTask(taskId, updates, {
          onError: (error) => toastApiError(error, t("common.error")),
        });
      },
      setPropertyValue: (taskId, propertyId, value) => {
        setPropertyValue(
          { taskId, propertyId, value },
          { onError: (error) => toastApiError(error, t("common.error")) },
        );
      },
      clearPropertyValue: (taskId, propertyId) => {
        unsetPropertyValue(
          { taskId, propertyId },
          { onError: (error) => toastApiError(error, t("common.error")) },
        );
      },
      openTask: onOpenTask,
      toggleTableParentExpanded,
      toggleTableColumn,
      propertiesDisabled,
      propertiesDisabledReason: t(propertiesDisabledReasonKey),
    }),
    [
      clearVisibleSelection,
      actions,
      assigneeOptions,
      childProgressByTask,
      columnLabel,
      editingDisabled,
      editingDisabledReasonKey,
      handleTaskSelection,
      labelsQuery.data?.labels,
      members,
      onOpenTask,
      onSort,
      projects,
      properties,
      propertiesDisabled,
      propertiesDisabledReasonKey,
      selectAllVisible,
      setPropertyValue,
      unsetPropertyValue,
      showSubTasks,
      sortBy,
      sortDirection,
      t,
      toggleTableParentExpanded,
      toggleTableColumn,
      visibleTaskIds,
      workspaceId,
    ],
  );

  const table = useReactTable({
    data: data.displayRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.key,
    // No pagination row model here. Left on, every row-model rebuild writes a
    // fresh pagination object into useReactTable's own state and renders again.
    autoResetPageIndex: false,
    columnResizeMode: "onChange",
    state: {
      columnSizing,
      columnPinning: { left: ["__select", "title"], right: [] },
    },
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
        propertyGroupings={propertyGroupings}
        properties={properties}
        propertiesDisabled={propertiesDisabled}
        propertiesDisabledReason={t(propertiesDisabledReasonKey)}
      />
      {data.groupsError ? (
        <TableLoadErrorState onRetry={data.retry} />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {data.isShowingPrevious ? <TableRefreshingBar /> : null}
          <DataTable
            table={table}
            className="min-h-0 flex-1"
            virtualizeRows={data.displayRows.length > 40}
            virtualRowHeight={40}
            // A new sort, search, grouping or filter opens at the first row.
            scrollResetKey={data.queryIdentity}
            // 40px exactly: the 28px cell controls fill the row without the
            // default py-2, which would make it 45px and drift from the estimate.
            rowClassName="h-10 [&>td]:py-0"
            gridLines="horizontal"
            footer={
              <SelectionToolbarSpacer
                colSpan={table.getVisibleLeafColumns().length}
              />
            }
            reorderableColumnIds={reorderableColumnIds}
            onColumnReorder={onColumnReorder}
            reorderHandleLabel={reorderHandleLabel}
            emptyMessage={
              <TableEmptyMessage search={data.search} onClearSearch={() => setSearch("")} />
            }
            onRowClick={(row, event) => {
              if (row.original.kind === "group") {
                toggleTableGroupCollapsed(row.original.key);
                return;
              }
              if (row.original.kind !== "task" || !onOpenTask) return;
              if (isRowControlTarget(event.target)) return;
              onOpenTask(row.original.task.id);
            }}
            renderRow={(row) => {
              if (row.original.kind === "group") {
                return (
                  <TaskTableGroupRow
                    group={row.original}
                    color={row.original.color}
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
        </div>
      )}
      <BatchActionToolbar
        workspaceId={workspaceId}
        tasks={data.loadedTasks}
        members={members}
      />
    </div>
  );
}

/**
 * Room at the end of the scroll surface for the floating batch toolbar, so
 * the last rows and "Tải thêm" can scroll clear of it. Its own subscriber:
 * reading the selection in TableView would re-render every cell on a tick.
 */
function SelectionToolbarSpacer({ colSpan }: { colSpan: number }) {
  const hasSelection = useHasTaskSelection();
  if (!hasSelection) return null;
  return (
    <tfoot aria-hidden data-slot="task-table-selection-spacer">
      <tr>
        {/* h-20: the toolbar (46px) plus its bottom-6 offset, and a gap. */}
        <td colSpan={colSpan} className="h-20 p-0" />
      </tr>
    </tfoot>
  );
}
