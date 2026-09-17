"use client";

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  TableFilter,
  TableGroupsResult,
  TableQuery,
} from "@uniwork/core/api/endpoints/tasks-table";
import { useTableGroups } from "@uniwork/core/tasks";
import {
  normalizeTableQuery,
  tableGroupsBody,
  tableRowsPageBody,
} from "@uniwork/core/tasks/surface/table-query";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task } from "@uniwork/core/types";
import {
  useCursorBranches,
  type CursorBranchSpec,
  type CursorBranchState,
} from "../surface/use-cursor-branches";
import {
  TABLE_PAGE_SIZE,
  buildTaskTableHierarchy,
  groupLabelFromDescriptor,
  tableGroupBy,
  tableUsesServerGrouping,
  type TaskTableDisplayRow,
} from "./table-view-model";
import { useDebouncedValue } from "./use-debounced-value";

const EMPTY_GROUPS: TableGroupsResult["groups"] = [];
const EMPTY_PARENT_IDS: string[] = [];
const EMPTY_TASKS: Task[] = [];
const UNGROUPED_BRANCH = "__ungrouped";
const SEARCH_DEBOUNCE_MS = 300;

export interface UseTableViewDataResult {
  displayRows: TaskTableDisplayRow[];
  loadedTasks: Task[];
  total: number;
  isLoading: boolean;
  isRefreshing: boolean;
  isEmpty: boolean;
  groupBy: string;
  groupsError: boolean;
}

/**
 * Table data on the cursor table API: the server filters, searches and sorts;
 * each open group (or the whole table, ungrouped) is one cursor branch paged
 * through `useCursorBranches`. Bodies come from `tasks/surface/table-query`, as
 * the board's do, so a status-grouped table shares the board's cache entries.
 */
export function useTableViewData({
  workspaceId,
  filter,
  search = "",
  collapsedParentIds = EMPTY_PARENT_IDS,
  showSubTasks = true,
  assigneeNames,
}: {
  workspaceId: string;
  filter?: TableFilter;
  search?: string;
  collapsedParentIds?: string[];
  showSubTasks?: boolean;
  assigneeNames?: ReadonlyMap<string, string>;
}): UseTableViewDataResult {
  const { t } = useTranslation();
  const tableGrouping = useViewStore((s) => s.tableGrouping);
  const tableCollapsedGroups = useViewStore((s) => s.tableCollapsedGroups);
  const sortBy = useViewStore((s) => s.sortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const groupBy = tableGroupBy(tableGrouping);
  const usesServerGrouping = tableUsesServerGrouping(tableGrouping);

  const query = useMemo<TableQuery>(
    () =>
      normalizeTableQuery({
        filter,
        search: debouncedSearch,
        sort: { field: sortBy, direction: sortDirection },
      }),
    [debouncedSearch, filter, sortBy, sortDirection],
  );

  const groupsQuery = useTableGroups(
    workspaceId,
    usesServerGrouping ? tableGroupsBody({ query, groupBy }) : null,
  );
  const groups = groupsQuery.data?.groups ?? EMPTY_GROUPS;
  const collapsed = useMemo(
    () => new Set(tableCollapsedGroups),
    [tableCollapsedGroups],
  );

  const branchBody = (groupKey: string | null) =>
    tableRowsPageBody({
      query,
      groupBy,
      hierarchy: false,
      groupKey,
      parentId: null,
      cursor: null,
      limit: TABLE_PAGE_SIZE,
    });
  const branches: CursorBranchSpec[] = [];
  if (!usesServerGrouping) {
    branches.push({ key: UNGROUPED_BRANCH, body: branchBody(null), enabled: true });
  } else {
    for (const group of groups) {
      if (collapsed.has(group.key)) continue;
      branches.push({ key: group.key, body: branchBody(group.key), enabled: true });
    }
  }
  const { byKey, isRefreshing: branchesRefreshing } = useCursorBranches(
    workspaceId,
    branches,
  );

  const translateStatus = useCallback(
    (status: string) => {
      const key = `tasks.status_${status}`;
      const translated = t(key);
      return translated === key ? status : translated;
    },
    [t],
  );
  const translatePriority = useCallback(
    (priority: string) => {
      const key = `tasks.priority_${priority}`;
      const translated = t(key);
      return translated === key ? priority : translated;
    },
    [t],
  );

  const ungrouped = usesServerGrouping ? undefined : byKey.get(UNGROUPED_BRANCH);

  const displayRows = useMemo(() => {
    const rows: TaskTableDisplayRow[] = [];
    const collapsedParents = new Set(collapsedParentIds);

    if (
      (usesServerGrouping && groupsQuery.isLoading && groups.length === 0) ||
      (!usesServerGrouping && (!ungrouped || ungrouped.isLoading))
    ) {
      for (let i = 0; i < 8; i += 1) {
        rows.push({ kind: "skeleton", key: `skeleton:${i}` });
      }
      return rows;
    }

    const appendBranch = (branch: CursorBranchState | undefined, skeletonHint: number) => {
      if (!branch || branch.isLoading) {
        for (let i = 0; i < Math.min(skeletonHint || 3, 3); i += 1) {
          rows.push({ kind: "skeleton", key: `skeleton:${branch?.key ?? "branch"}:${i}` });
        }
        return;
      }

      const tasks = branch.rows.map((row) => row.task);
      const childCountById = new Map(
        branch.rows.map((row) => [row.task.id, row.direct_child_count]),
      );
      const hierarchyRows = showSubTasks
        ? buildTaskTableHierarchy(tasks, childCountById, collapsedParents)
        : tasks
            .filter((task) => !task.parent_task_id)
            .map((task) => ({
              kind: "task" as const,
              key: task.id,
              task,
              depth: 0,
              hasChildren: false,
              collapsed: false,
            }));
      rows.push(...hierarchyRows);

      if (branch.hasMore || branch.isFetchingMore || branch.isError) {
        rows.push({
          kind: "load_more",
          key: `load_more:${branch.key}`,
          state: branch.isError ? "error" : branch.isFetchingMore ? "loading" : "has_more",
          total: branch.total,
          loadedCount: branch.rows.length,
          onLoad: branch.isError ? branch.retry : branch.loadMore,
        });
      }
    };

    if (!usesServerGrouping) {
      appendBranch(ungrouped, 0);
      return rows;
    }

    for (const group of groups) {
      const isCollapsed = collapsed.has(group.key);
      rows.push({
        kind: "group",
        key: group.key,
        label: groupLabelFromDescriptor(
          group.key,
          group.value,
          translateStatus,
          translatePriority,
          t("tasks.unassigned"),
          (id) => assigneeNames?.get(id),
        ),
        count: group.count,
        collapsed: isCollapsed,
      });
      if (isCollapsed) continue;
      appendBranch(byKey.get(group.key), group.count);
    }

    return rows;
  }, [
    assigneeNames,
    byKey,
    collapsed,
    collapsedParentIds,
    groups,
    groupsQuery.isLoading,
    showSubTasks,
    t,
    translatePriority,
    translateStatus,
    ungrouped,
    usesServerGrouping,
  ]);

  const loadedTasks = useMemo(() => {
    const byId = new Map<string, Task>();
    for (const branch of byKey.values()) {
      for (const row of branch.rows) {
        if (!byId.has(row.task.id)) byId.set(row.task.id, row.task);
      }
    }
    return byId.size > 0 ? [...byId.values()] : EMPTY_TASKS;
  }, [byKey]);

  const branchStates = [...byKey.values()];
  const rowsLoading = branchStates.some((branch) => branch.isLoading);
  const isLoading = usesServerGrouping
    ? groupsQuery.isLoading || (groups.length > 0 && rowsLoading)
    : !ungrouped || ungrouped.isLoading;
  const isRefreshing =
    !isLoading &&
    ((usesServerGrouping && groupsQuery.isFetching && !groupsQuery.isLoading) ||
      branchesRefreshing);
  const total = usesServerGrouping
    ? (groupsQuery.data?.total ?? loadedTasks.length)
    : (ungrouped?.total ?? loadedTasks.length);
  const isEmpty = !isLoading && total === 0;

  return {
    displayRows,
    loadedTasks,
    total,
    isLoading,
    isRefreshing,
    isEmpty,
    groupBy,
    groupsError: usesServerGrouping
      ? groupsQuery.isError
      : !!ungrouped?.isError && ungrouped.rows.length === 0,
  };
}
