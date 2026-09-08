"use client";

import { useCallback, useMemo } from "react";
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
  groupLabelFromDescriptor,
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
      limit: 50,
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

  const rowQueries = useQueries({
    queries: groups.map((group) => ({
      queryKey: taskKeys.tableRows(
        workspaceId,
        JSON.stringify({
          filter,
          group_by: groupBy,
          group_key: group.key,
          columns,
          limit: 50,
          offset: 0,
        }),
      ),
      queryFn: () =>
        tableRows(workspaceId, {
          filter,
          group_by: groupBy,
          group_key: group.key,
          columns,
          limit: 50,
          offset: 0,
        }),
      enabled: !!workspaceId && !collapsed.has(group.key),
    })),
  });

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

  const displayRows = useMemo(() => {
    const rows: TaskTableDisplayRow[] = [];
    const needle = search.trim().toLocaleLowerCase();

    if (groupsQuery.isLoading && groups.length === 0) {
      for (let i = 0; i < 8; i += 1) {
        rows.push({ kind: "skeleton", key: `skeleton:${i}` });
      }
      return rows;
    }

    groups.forEach((group, index) => {
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

      if (isCollapsed) return;

      const query = rowQueries[index];
      if (!query || query.isLoading) {
        for (let i = 0; i < Math.min(group.count, 3); i += 1) {
          rows.push({
            kind: "skeleton",
            key: `skeleton:${group.key}:${i}`,
          });
        }
        return;
      }

      const page = query.data as TableRowsResult | undefined;
      const pageRows = page?.rows ?? [];
      for (const row of pageRows) {
        if (
          needle &&
          !row.task.title.toLocaleLowerCase().includes(needle) &&
          !(row.task.identifier ?? "").toLocaleLowerCase().includes(needle)
        ) {
          continue;
        }
        rows.push({
          kind: "task",
          key: row.task.id,
          task: row.task,
          depth: 0,
          hasChildren: row.direct_child_count > 0,
          collapsed: false,
        });
      }
    });

    return rows;
  }, [
    collapsed,
    groups,
    groupsQuery.isLoading,
    rowQueries,
    search,
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
    (groups.length > 0 && rowQueries.some((query) => query.isLoading));
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
