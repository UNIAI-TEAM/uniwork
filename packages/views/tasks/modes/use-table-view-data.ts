"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  tableRows,
  type TableFilter,
  type TableGroupsResult,
  type TableRowsResult,
} from "@uniwork/core/api/endpoints/tasks-table";
import { taskKeys, useTableGroups } from "@uniwork/core/tasks";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type { Task } from "@uniwork/core/types";
import {
  TABLE_PAGE_SIZE,
  buildTaskTableHierarchy,
  groupLabelFromDescriptor,
  sortTasksForTable,
  tableGroupBy,
  tableUsesServerGrouping,
  type TaskTableDisplayRow,
} from "./table-view-model";

const EMPTY_GROUPS: TableGroupsResult["groups"] = [];
const EMPTY_PARENT_IDS: string[] = [];

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

type PageQuery = {
  branchKey: string;
  groupKey: string | null;
  pageIndex: number;
};

const UNGROUPED_BRANCH = "__ungrouped";

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

  const groupBy = tableGroupBy(tableGrouping);
  const usesServerGrouping = tableUsesServerGrouping(tableGrouping);
  const tableColumns = useViewStore((s) => s.tableColumns);
  const columns = useMemo(
    () => tableColumns.map((column) => column.key),
    [tableColumns],
  );

  const groupsBody = useMemo(
    () => ({
      filter,
      group_by: groupBy,
      columns,
      limit: TABLE_PAGE_SIZE,
      offset: 0,
    }),
    [columns, filter, groupBy],
  );

  const groupsQuery = useTableGroups(
    workspaceId,
    usesServerGrouping ? groupsBody : null,
  );
  const groups = groupsQuery.data?.groups ?? EMPTY_GROUPS;
  const collapsed = useMemo(
    () => new Set(tableCollapsedGroups),
    [tableCollapsedGroups],
  );

  const [pagesByGroup, setPagesByGroup] = useState<Record<string, number>>({});

  useEffect(() => {
    setPagesByGroup({});
  }, [workspaceId, groupBy, columns, filter, usesServerGrouping]);

  const pageQueries = useMemo((): PageQuery[] => {
    const list: PageQuery[] = [];
    if (!usesServerGrouping) {
      const pages = pagesByGroup[UNGROUPED_BRANCH] ?? 1;
      for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
        list.push({
          branchKey: UNGROUPED_BRANCH,
          groupKey: null,
          pageIndex,
        });
      }
      return list;
    }
    for (const group of groups) {
      if (collapsed.has(group.key)) continue;
      const pages = pagesByGroup[group.key] ?? 1;
      for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
        list.push({
          branchKey: group.key,
          groupKey: group.key,
          pageIndex,
        });
      }
    }
    return list;
  }, [collapsed, groups, pagesByGroup, usesServerGrouping]);

  const rowQueries = useQueries({
    queries: pageQueries.map(({ groupKey, pageIndex }) => ({
      queryKey: taskKeys.tableRows(
        workspaceId,
        JSON.stringify({
          filter,
          group_by: groupBy,
          group_key: groupKey,
          columns,
          limit: TABLE_PAGE_SIZE,
          offset: pageIndex * TABLE_PAGE_SIZE,
        }),
      ),
      queryFn: () =>
        tableRows(workspaceId, {
          filter,
          group_by: groupBy,
          group_key: groupKey,
          columns,
          limit: TABLE_PAGE_SIZE,
          offset: pageIndex * TABLE_PAGE_SIZE,
        }),
      enabled: !!workspaceId,
    })),
  });

  const loadMore = useCallback((groupKey: string) => {
    setPagesByGroup((prev) => ({
      ...prev,
      [groupKey]: (prev[groupKey] ?? 1) + 1,
    }));
  }, []);

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

  const pagesForGroup = useCallback(
    (branchKey: string) => {
      const pages: Array<{
        data?: TableRowsResult;
        isLoading: boolean;
        isError: boolean;
        isFetching: boolean;
      }> = [];
      pageQueries.forEach((page, index) => {
        if (page.branchKey !== branchKey) return;
        const query = rowQueries[index];
        if (!query) return;
        pages.push({
          data: query.data as TableRowsResult | undefined,
          isLoading: query.isLoading,
          isError: query.isError,
          isFetching: query.isFetching,
        });
      });
      return pages;
    },
    [pageQueries, rowQueries],
  );

  const displayRows = useMemo(() => {
    const rows: TaskTableDisplayRow[] = [];
    const needle = search.trim().toLocaleLowerCase();
    const collapsedParents = new Set(collapsedParentIds);

    if (
      (usesServerGrouping && groupsQuery.isLoading && groups.length === 0) ||
      (!usesServerGrouping &&
        rowQueries.some((query) => query.isLoading && !query.data))
    ) {
      for (let i = 0; i < 8; i += 1) {
        rows.push({ kind: "skeleton", key: `skeleton:${i}` });
      }
      return rows;
    }

    const appendBranch = (
      branchKey: string,
      groupTotalHint: number,
    ) => {
      const pages = pagesForGroup(branchKey);
      const anyLoading = pages.some((page) => page.isLoading && !page.data);
      if (pages.length === 0 || anyLoading) {
        for (let i = 0; i < Math.min(groupTotalHint || 3, 3); i += 1) {
          rows.push({
            kind: "skeleton",
            key: `skeleton:${branchKey}:${i}`,
          });
        }
        return;
      }

      const accumulated: Array<{ task: Task; direct_child_count: number }> = [];
      let groupTotal = groupTotalHint;
      let lastError = false;
      let fetchingMore = false;
      for (const page of pages) {
        if (page.isError && !page.data) lastError = true;
        if (page.isFetching && page.data) fetchingMore = true;
        if (page.data) {
          groupTotal = page.data.total;
          accumulated.push(...page.data.rows);
        }
      }

      const tasks = sortTasksForTable(
        accumulated.map((row) => row.task),
        sortBy,
        sortDirection,
      );
      const childCountById = new Map(
        accumulated.map((row) => [row.task.id, row.direct_child_count]),
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

      for (const row of hierarchyRows) {
        if (
          needle &&
          !row.task.title.toLocaleLowerCase().includes(needle) &&
          !(row.task.identifier ?? "").toLocaleLowerCase().includes(needle)
        ) {
          continue;
        }
        rows.push(row);
      }

      if (accumulated.length < groupTotal) {
        rows.push({
          kind: "load_more",
          key: `load_more:${branchKey}`,
          state: lastError
            ? "error"
            : fetchingMore
              ? "loading"
              : "has_more",
          total: groupTotal,
          loadedCount: accumulated.length,
          onLoad: () => loadMore(branchKey),
        });
      }
    };

    if (!usesServerGrouping) {
      appendBranch(UNGROUPED_BRANCH, 0);
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
      appendBranch(group.key, group.count);
    }

    return rows;
  }, [
    collapsed,
    collapsedParentIds,
    assigneeNames,
    groups,
    groupsQuery.isLoading,
    loadMore,
    pagesForGroup,
    search,
    showSubTasks,
    sortBy,
    sortDirection,
    t,
    translatePriority,
    translateStatus,
    usesServerGrouping,
    rowQueries,
  ]);

  const loadedTasks = useMemo(() => {
    const byId = new Map<string, Task>();
    for (const query of rowQueries) {
      const page = query.data as TableRowsResult | undefined;
      for (const row of page?.rows ?? []) byId.set(row.task.id, row.task);
    }
    return [...byId.values()];
  }, [rowQueries]);

  const rowsLoading = rowQueries.some(
    (query) => query.isLoading && !query.data,
  );
  const isLoading = usesServerGrouping
    ? groupsQuery.isLoading || (groups.length > 0 && rowsLoading)
    : rowsLoading;
  const isRefreshing =
    (groupsQuery.isFetching && !groupsQuery.isLoading) ||
    rowQueries.some((query) => query.isFetching && !query.isLoading);
  const ungroupedTotal = (rowQueries[0]?.data as TableRowsResult | undefined)
    ?.total;
  const total = usesServerGrouping
    ? (groupsQuery.data?.total ?? loadedTasks.length)
    : (ungroupedTotal ?? loadedTasks.length);
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
      : rowQueries.some((query) => query.isError && !query.data),
  };
}
