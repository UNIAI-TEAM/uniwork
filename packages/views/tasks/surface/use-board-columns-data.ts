"use client";

import { useMemo, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { TableQuery, TableRowsResult } from "@uniwork/core/api/endpoints/tasks-table";
import { useTableGroups } from "@uniwork/core/tasks";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import {
  normalizeTableQuery,
  tableGroupsBody,
  tableRowsPageBody,
} from "@uniwork/core/tasks/surface/table-query";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { TABLE_PAGE_SIZE } from "../modes/table-view-model";
import { useCursorBranches, type CursorBranchSpec } from "./use-cursor-branches";
import type { TaskSurfacePagination } from "./use-task-surface-data";

/** Board columns are status buckets; the table API keys each one `status:<status>`. */
const BOARD_GROUP_BY = "status";
const STATUS_KEY_PREFIX = "status:";
const EMPTY_TASKS: Task[] = [];

/** Where one status column's server paging stands. */
export interface BoardColumnPaging {
  /** Tasks in the column on the server; never below the tasks loaded. */
  count: number;
  hasMore: boolean;
  /** A page after the column's first is in flight. */
  isLoadingMore: boolean;
  /** The column's last requested page failed; the pages before it stay. */
  isError: boolean;
  /** Asks for the next page, or again for the page that failed. */
  loadMore: () => void;
}

interface BoardColumnState extends BoardColumnPaging {
  status: string;
  /** Loaded pages in order, one task per id. */
  tasks: Task[];
  /** The first page has not arrived yet. */
  isLoading: boolean;
}

/**
 * Kept for the table view (use-table-view-data.ts), which still pages on its
 * own until it moves onto `useCursorBranches`; the board no longer uses it.
 */
export type PageState = Pick<
  UseQueryResult<TableRowsResult>,
  "data" | "isError" | "isLoading" | "isFetching" | "refetch"
>;

/**
 * The page fields a `useQueries` reader keeps, as plain objects. Passed as
 * `combine` (a stable function), the result keeps its identity until one of
 * these fields changes.
 */
export function pickPageStates(results: readonly PageState[]): PageState[] {
  return results.map(({ data, isError, isLoading, isFetching, refetch }) => ({
    data,
    isError,
    isLoading,
    isFetching,
    refetch,
  }));
}

/**
 * Board data on the table API: one groups call for every column's count, then
 * one cursor branch per status column (`group_key` `status:<status>`), pages of
 * 50 each, paged on its own through `useCursorBranches`. Bodies come from
 * `tasks/surface/table-query`, as the table view's do.
 */
export function useBoardColumnsData({
  workspaceId,
  projectId,
  categories,
  enabled,
}: {
  workspaceId: string;
  projectId?: string;
  /** Status categories the board shows, in column order. */
  categories: readonly string[];
  enabled: boolean;
}) {
  const hiddenStatuses = useViewStore((s) => s.hiddenStatusCategories);
  const grouping = useViewStore((s) => s.grouping);
  // Assignee and project boards regroup every loaded task, hidden statuses included.
  const skipsHidden = grouping !== "assignee" && grouping !== "project";
  const query = useMemo<TableQuery>(
    () => normalizeTableQuery({ filter: projectId ? { project_ids: [projectId] } : undefined }),
    [projectId],
  );
  const identity = JSON.stringify([workspaceId, query]);

  const groupsQuery = useTableGroups(
    enabled ? workspaceId : "",
    enabled ? tableGroupsBody({ query, groupBy: BOARD_GROUP_BY }) : null,
  );
  const groups = groupsQuery.data?.groups;
  const countByStatus = useMemo(
    () =>
      new Map(
        (groups ?? []).map((group) => [
          group.value.status ??
            (group.key.startsWith(STATUS_KEY_PREFIX)
              ? group.key.slice(STATUS_KEY_PREFIX.length)
              : group.key),
          group.count,
        ]),
      ),
    [groups],
  );

  const branches: CursorBranchSpec[] = [];
  if (enabled) {
    for (const status of categories) {
      // A column the groups call leaves out is empty: no rows to ask for.
      if ((countByStatus.get(status) ?? 0) === 0) continue;
      if (skipsHidden && hiddenStatuses.includes(status as TaskStatus)) continue;
      branches.push({
        key: status,
        body: tableRowsPageBody({
          query,
          groupBy: BOARD_GROUP_BY,
          hierarchy: false,
          groupKey: `${STATUS_KEY_PREFIX}${status}`,
          parentId: null,
          cursor: null,
          limit: TABLE_PAGE_SIZE,
        }),
        enabled: true,
      });
    }
  }
  const { byKey, isRefreshing: branchesRefreshing } = useCursorBranches(workspaceId, branches);

  const columns = useMemo(() => {
    const result: Record<string, BoardColumnState> = {};
    for (const status of categories) {
      const branch = byKey.get(status);
      const tasks = branch && branch.rows.length > 0 ? branch.rows.map((row) => row.task) : EMPTY_TASKS;
      const groupCount = countByStatus.get(status) ?? 0;
      if (!branch) {
        result[status] = {
          status,
          tasks,
          count: groupCount,
          hasMore: false,
          isLoading: false,
          isLoadingMore: false,
          isError: false,
          loadMore: () => {},
        };
        continue;
      }
      result[status] = {
        status,
        tasks,
        count: Math.max(groupCount, branch.total, tasks.length),
        // A page in flight or failed keeps the footer up for its loading or retry state.
        hasMore: branch.hasMore || branch.isLoading || branch.isFetchingMore || branch.isError,
        isLoading: branch.isLoading,
        // The first page counts too: a column that fills after the board loaded shows it in its footer.
        isLoadingMore: branch.isLoading || branch.isFetchingMore,
        isError: branch.isError,
        loadMore: branch.loadMore,
      };
    }
    return result;
  }, [byKey, categories, countByStatus]);

  const tasks = useMemo(() => {
    const seen = new Set<string>();
    const all: Task[] = [];
    for (const status of categories) {
      for (const task of columns[status]?.tasks ?? EMPTY_TASKS) {
        // A task mid-move can sit in two columns' pages; it gets one card.
        if (seen.has(task.id)) continue;
        seen.add(task.id);
        all.push(task);
      }
    }
    return all.length > 0 ? all : EMPTY_TASKS;
  }, [categories, columns]);

  const groupsTotal = groupsQuery.data?.total ?? 0;
  const pagination = useMemo<TaskSurfacePagination>(() => {
    const list = Object.values(columns);
    const withMore = list.filter((column) => column.hasMore);
    const loaded = tasks.length;
    return {
      loaded,
      total: Math.max(
        groupsTotal,
        list.reduce((sum, column) => sum + column.count, 0),
        loaded,
      ),
      hasMore: withMore.length > 0,
      isLoadingMore: withMore.some((column) => column.isLoadingMore),
      isLoadMoreError: withMore.some((column) => column.isError),
      loadMore: () => {
        for (const column of withMore) column.loadMore();
      },
    };
  }, [columns, groupsTotal, tasks.length]);

  // The board loads as a whole once: the groups call, then its first pages
  // until one column has cards. A column that fills later (a drop into an empty
  // column, a refetch that brings a task in) loads inside that column, so the
  // surface never swaps a board on screen for its skeleton. That holds even
  // when every page the board still asks for is new, as when the only column
  // with tasks empties into one that had none; switched off, it starts over.
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const branchStates = [...byKey.values()];
  const waitsForFirstPages =
    loadedIdentity !== identity &&
    branchStates.some((branch) => branch.isLoading) &&
    !branchStates.some((branch) => !branch.isLoading && !branch.isError);
  const isLoading = enabled && (groupsQuery.isLoading || waitsForFirstPages);
  if (enabled && !isLoading && groupsQuery.data !== undefined && loadedIdentity !== identity) {
    setLoadedIdentity(identity);
  } else if (!enabled && loadedIdentity !== null) {
    setLoadedIdentity(null);
  }
  const isRefreshing =
    enabled &&
    !isLoading &&
    ((groupsQuery.isFetching && !groupsQuery.isLoading) ||
      branchesRefreshing);

  return {
    columns,
    /** Every column's loaded tasks, one per id across the board. */
    tasks,
    /** The whole board as one loaded / total, for boards whose columns are not status columns. */
    pagination,
    isLoading,
    isRefreshing,
    // A failed column page stays in its column; only the groups call fails the board.
    isError: enabled && groupsQuery.isError,
  };
}
