"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { TableFilter, TableRowsResult } from "@uniwork/core/api/endpoints/tasks-table";
import { useTableGroups } from "@uniwork/core/tasks";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import {
  tableGroupsBody,
  tableRowsPageBody,
  tableRowsPageQuery,
} from "@uniwork/core/tasks/surface/table-query";
import type { Task, TaskStatus } from "@uniwork/core/types";
import { TABLE_PAGE_SIZE } from "../modes/table-view-model";
import type { TaskSurfacePagination } from "./use-task-surface-data";

/** Board columns are status buckets; the table API keys each one by its raw status. */
const BOARD_GROUP_BY = "status";
/**
 * The table API takes `columns` into its fingerprint only and returns whole
 * tasks, so the board sends a fixed minimum: the card's title and the field
 * its column stands for.
 */
const BOARD_TABLE_COLUMNS = ["title", "status"];
const NO_PAGES: Readonly<Record<string, number>> = {};
const EMPTY_TASKS: Task[] = [];

/** Where one status column's server paging stands. */
export interface BoardColumnPaging {
  /** Tasks in the column on the server; never below the tasks loaded. */
  count: number;
  hasMore: boolean;
  /** The column's last requested page is in flight. */
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

type PageState = Pick<
  UseQueryResult<TableRowsResult>,
  "data" | "isError" | "isLoading" | "isFetching" | "refetch"
>;

/**
 * The page fields the board reads, as plain objects. Passed to `useQueries`
 * as `combine` (a stable function), the result keeps its identity until one of
 * these fields changes, so the columns are not rebuilt on every render.
 */
function pickPageStates(results: readonly PageState[]): PageState[] {
  return results.map(({ data, isError, isLoading, isFetching, refetch }) => ({
    data,
    isError,
    isLoading,
    isFetching,
    refetch,
  }));
}

/**
 * A column's pages in order. Offset pages overlap when a task moves between two
 * page requests, so one id can arrive twice; the first copy wins.
 */
function mergeRows(pages: readonly PageState[]): Task[] {
  const seen = new Set<string>();
  const tasks: Task[] = [];
  for (const page of pages) {
    for (const row of page.data?.rows ?? []) {
      if (seen.has(row.task.id)) continue;
      seen.add(row.task.id);
      tasks.push(row.task);
    }
  }
  return tasks.length > 0 ? tasks : EMPTY_TASKS;
}

/**
 * Board data on the table API: one groups call for every column's count, then
 * pages of 50 per status column (`group_key`), each column paged on its own.
 * Bodies and keys come from `tasks/surface/table-query`, as the table view's do.
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
  const filter = useMemo<TableFilter | undefined>(
    () => (projectId ? { project_ids: [projectId] } : undefined),
    [projectId],
  );

  // Pages asked for per column, tagged with the query they were asked on. A new
  // filter reads as no pages instead of being reset in an effect, so no render
  // asks the new filter for a later page.
  const identity = JSON.stringify([workspaceId, filter ?? null]);
  const [paging, setPaging] = useState<{ identity: string; pages: Record<string, number> }>(
    () => ({ identity, pages: {} }),
  );
  const pagesByStatus = paging.identity === identity ? paging.pages : NO_PAGES;

  const groupsQuery = useTableGroups(
    enabled ? workspaceId : "",
    enabled
      ? tableGroupsBody({
          filter,
          groupBy: BOARD_GROUP_BY,
          columns: BOARD_TABLE_COLUMNS,
          limit: TABLE_PAGE_SIZE,
        })
      : null,
  );
  const groups = groupsQuery.data?.groups;
  const countByStatus = useMemo(
    () => new Map((groups ?? []).map((group) => [group.key, group.count])),
    [groups],
  );

  const pageQueries = useMemo(() => {
    const list: Array<{ status: string; pageIndex: number }> = [];
    if (!enabled) return list;
    for (const status of categories) {
      // A column the groups call leaves out is empty: no rows to ask for.
      if ((countByStatus.get(status) ?? 0) === 0) continue;
      if (skipsHidden && hiddenStatuses.includes(status as TaskStatus)) continue;
      const pages = pagesByStatus[status] ?? 1;
      for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
        list.push({ status, pageIndex });
      }
    }
    return list;
  }, [categories, countByStatus, enabled, hiddenStatuses, pagesByStatus, skipsHidden]);

  const pageStates = useQueries({
    queries: pageQueries.map(({ status, pageIndex }) => ({
      ...tableRowsPageQuery(
        workspaceId,
        tableRowsPageBody({
          filter,
          groupBy: BOARD_GROUP_BY,
          groupKey: status,
          columns: BOARD_TABLE_COLUMNS,
          limit: TABLE_PAGE_SIZE,
          offset: pageIndex * TABLE_PAGE_SIZE,
        }),
      ),
      enabled: !!workspaceId,
    })),
    combine: pickPageStates,
  });

  // Each page is its own query, so a click during a background refetch of the
  // loaded pages does not join that refetch: the next page starts at once.
  const requestPage = useCallback(
    (status: string, requested: number) => {
      setPaging((prev) => {
        const pages = prev.identity === identity ? prev.pages : NO_PAGES;
        // Asked for already: the button and the sentinel fired for one page.
        if ((pages[status] ?? 1) !== requested) return prev;
        return { identity, pages: { ...pages, [status]: requested + 1 } };
      });
    },
    [identity],
  );

  const columns = useMemo(() => {
    const pagesOf = new Map<string, PageState[]>();
    pageQueries.forEach(({ status }, index) => {
      const state = pageStates[index];
      if (state) pagesOf.set(status, [...(pagesOf.get(status) ?? []), state]);
    });
    const result: Record<string, BoardColumnState> = {};
    for (const status of categories) {
      const pages = pagesOf.get(status) ?? [];
      const tasks = mergeRows(pages);
      const last = pages[pages.length - 1];
      // The largest count any response gave, never below the loaded cards: a
      // malformed page parses to `total: 0`.
      const count = pages.reduce(
        (largest, page) => Math.max(largest, page.data?.total ?? 0),
        Math.max(countByStatus.get(status) ?? 0, tasks.length),
      );
      const isLoadingMore = !!last && !last.data && last.isFetching;
      const isError = !!last && last.isError && !last.data;
      // A short page ends the column whatever the count says. A page not in yet,
      // or failed, keeps the footer up for its loading or retry state.
      const hasMore = !last
        ? false
        : last.data
          ? last.data.rows.length >= TABLE_PAGE_SIZE && pages.length * TABLE_PAGE_SIZE < count
          : true;
      result[status] = {
        status,
        tasks,
        count,
        hasMore,
        isLoading: pages[0]?.isLoading ?? false,
        isLoadingMore,
        isError,
        loadMore: () => {
          if (isLoadingMore) return;
          if (isError) void last?.refetch();
          else if (hasMore) requestPage(status, pages.length);
        },
      };
    }
    return result;
  }, [categories, countByStatus, pageQueries, pageStates, requestPage]);

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
  const waitsForFirstPages =
    loadedIdentity !== identity &&
    pageStates.some((page) => page.isLoading) &&
    !pageStates.some((page) => page.data !== undefined);
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
      pageStates.some((page) => page.isFetching && page.data !== undefined));

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
