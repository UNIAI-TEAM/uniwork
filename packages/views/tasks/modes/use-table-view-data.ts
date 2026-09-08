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
  groupLabelFromDescriptor,
  sortTasksForTable,
  tableGroupBy,
  type TaskTableDisplayRow,
} from "./table-view-model";

const EMPTY_GROUPS: TableGroupsResult["groups"] = [];

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
  groupKey: string;
  pageIndex: number;
};

export function useTableViewData({
  workspaceId,
  filter,
  projectsAvailable = false,
  search = "",
}: {
  workspaceId: string;
  filter?: TableFilter;
  projectsAvailable?: boolean;
  search?: string;
}): UseTableViewDataResult {
  const { t } = useTranslation();
  const tableGrouping = useViewStore((s) => s.tableGrouping);
  const tableCollapsedGroups = useViewStore((s) => s.tableCollapsedGroups);
  const sortBy = useViewStore((s) => s.sortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);

  const groupBy = tableGroupBy(tableGrouping, { projectsAvailable });
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

  const groupsQuery = useTableGroups(workspaceId, groupsBody);
  const groups = groupsQuery.data?.groups ?? EMPTY_GROUPS;
  const collapsed = useMemo(
    () => new Set(tableCollapsedGroups),
    [tableCollapsedGroups],
  );

  const [pagesByGroup, setPagesByGroup] = useState<Record<string, number>>({});

  useEffect(() => {
    setPagesByGroup({});
  }, [workspaceId, groupBy, columns, filter]);

  const pageQueries = useMemo((): PageQuery[] => {
    const list: PageQuery[] = [];
    for (const group of groups) {
      if (collapsed.has(group.key)) continue;
      const pages = pagesByGroup[group.key] ?? 1;
      for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
        list.push({ groupKey: group.key, pageIndex });
      }
    }
    return list;
  }, [collapsed, groups, pagesByGroup]);

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
    (groupKey: string) => {
      const pages: Array<{
        data?: TableRowsResult;
        isLoading: boolean;
        isError: boolean;
        isFetching: boolean;
      }> = [];
      pageQueries.forEach((page, index) => {
        if (page.groupKey !== groupKey) return;
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

    if (groupsQuery.isLoading && groups.length === 0) {
      for (let i = 0; i < 8; i += 1) {
        rows.push({ kind: "skeleton", key: `skeleton:${i}` });
      }
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
        ),
        count: group.count,
        collapsed: isCollapsed,
      });

      if (isCollapsed) continue;

      const pages = pagesForGroup(group.key);
      const anyLoading = pages.some((page) => page.isLoading && !page.data);
      if (pages.length === 0 || anyLoading) {
        for (let i = 0; i < Math.min(group.count, 3); i += 1) {
          rows.push({
            kind: "skeleton",
            key: `skeleton:${group.key}:${i}`,
          });
        }
        continue;
      }

      const accumulated: Array<{ task: Task; direct_child_count: number }> = [];
      let groupTotal = group.count;
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

      for (const task of tasks) {
        if (
          needle &&
          !task.title.toLocaleLowerCase().includes(needle) &&
          !(task.identifier ?? "").toLocaleLowerCase().includes(needle)
        ) {
          continue;
        }
        rows.push({
          kind: "task",
          key: task.id,
          task,
          depth: 0,
          hasChildren: (childCountById.get(task.id) ?? 0) > 0,
          collapsed: false,
        });
      }

      if (accumulated.length < groupTotal) {
        rows.push({
          kind: "load_more",
          key: `load_more:${group.key}`,
          state: lastError
            ? "error"
            : fetchingMore
              ? "loading"
              : "has_more",
          total: groupTotal,
          loadedCount: accumulated.length,
          onLoad: () => loadMore(group.key),
        });
      }
    }

    return rows;
  }, [
    collapsed,
    groups,
    groupsQuery.isLoading,
    loadMore,
    pagesForGroup,
    search,
    sortBy,
    sortDirection,
    t,
    translatePriority,
    translateStatus,
  ]);

  const loadedTasks = useMemo(() => {
    const byId = new Map<string, Task>();
    for (const query of rowQueries) {
      const page = query.data as TableRowsResult | undefined;
      for (const row of page?.rows ?? []) byId.set(row.task.id, row.task);
    }
    return [...byId.values()];
  }, [rowQueries]);

  const isLoading =
    groupsQuery.isLoading ||
    (groups.length > 0 &&
      rowQueries.some((query) => query.isLoading && !query.data));
  const isRefreshing =
    (groupsQuery.isFetching && !groupsQuery.isLoading) ||
    rowQueries.some((query) => query.isFetching && !query.isLoading);
  const total = groupsQuery.data?.total ?? loadedTasks.length;
  const isEmpty = !isLoading && total === 0;

  return {
    displayRows,
    loadedTasks,
    total,
    isLoading,
    isRefreshing,
    isEmpty,
    groupBy,
    groupsError: groupsQuery.isError,
  };
}
