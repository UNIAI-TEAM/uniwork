"use client";

import { useCallback, useMemo, useState } from "react";
import { useInfiniteMyTasks, useInfiniteQueryTasks } from "@uniwork/core/tasks";
import type { SurfaceQueryPlan } from "@uniwork/core/tasks/surface/query-plan";
import type { Task, TaskQueryPage } from "@uniwork/core/types";

const EMPTY_TASKS: Task[] = [];
const NO_FILTER = {};

/** Where the flat, offset-paged list query stands. */
export interface TaskSurfacePagination {
  /** Tasks loaded so far, each id counted once. */
  loaded: number;
  /** Tasks the server says match the query; never below `loaded`. */
  total: number;
  hasMore: boolean;
  /** A next page is in flight, or a load-more request waits for a refetch to finish first. */
  isLoadingMore: boolean;
  /** The last next-page request failed; the pages already loaded stay. */
  isLoadMoreError: boolean;
  /**
   * Asks for the next page; does nothing while one is loading or none is left.
   * During a background refetch it waits for that refetch, then asks.
   */
  loadMore: () => void;
}

export interface TaskSurfaceData {
  /** Every loaded page, merged in order, one row per id. */
  surfaceTasks: Task[];
  pagination: TaskSurfacePagination;
  isLoading: boolean;
  isRefreshing: boolean;
  isEmpty: boolean;
  isError: boolean;
}

/**
 * Offset pages overlap when a task moves between two page requests (someone
 * edits it, a realtime refetch reorders), so one id can arrive twice. The
 * first occurrence wins.
 */
function mergePages(pages: readonly TaskQueryPage[] | undefined): Task[] {
  if (!pages || pages.length === 0) return EMPTY_TASKS;
  const seen = new Set<string>();
  const merged: Task[] = [];
  for (const page of pages) {
    for (const task of page.tasks) {
      if (seen.has(task.id)) continue;
      seen.add(task.id);
      merged.push(task);
    }
  }
  return merged;
}

export function useTaskSurfaceData({
  workspaceId,
  queryPlan,
  enabled,
}: {
  workspaceId: string;
  queryPlan: SurfaceQueryPlan;
  enabled: boolean;
}): TaskSurfaceData {
  const useWorkspace =
    enabled && queryPlan.kind === "workspace_query";
  const useMy = enabled && queryPlan.kind === "my_tasks";

  // Hooks always run; empty workspaceId disables the query (enabled: !!id).
  const workspaceQuery = useInfiniteQueryTasks(
    useWorkspace ? workspaceId : "",
    queryPlan.queryBody ?? NO_FILTER,
  );
  const myTasksQuery = useInfiniteMyTasks(
    useMy ? workspaceId : "",
    queryPlan.myTasksOpts ?? NO_FILTER,
  );

  const active = useMy ? myTasksQuery : useWorkspace ? workspaceQuery : null;
  const pages = active?.data?.pages;

  const surfaceTasks = useMemo(() => mergePages(pages), [pages]);
  const loaded = surfaceTasks.length;
  // The largest count any page reported, not the last page's: a malformed page
  // parses to `total: 0` and would otherwise read "50 / 0".
  const total = (pages ?? []).reduce(
    (largest, page) => Math.max(largest, page.total),
    loaded,
  );
  const hasMore = !!active && active.hasNextPage;
  // Held from a load-more request until the page it asked for settles, so a
  // request waiting behind a refetch reads as loading, like one in flight.
  const [isAwaitingPage, setAwaitingPage] = useState(false);
  const isLoadingMore = !!active && (active.isFetchingNextPage || isAwaitingPage);
  const isLoadMoreError = !!active && active.isFetchNextPageError;
  const fetchNextPage = active?.fetchNextPage;
  const loadedPages = pages?.length ?? 0;

  const loadMore = useCallback(() => {
    if (!fetchNextPage || !hasMore || isLoadingMore) return;
    setAwaitingPage(true);
    // cancelRefetch: false joins a fetch already in flight instead of
    // restarting it, so the button and the sentinel can fire for the same
    // page and still send one request. The fetch joined can also be a
    // background refetch of the loaded pages (a realtime event), which
    // settles without a new page: ask again once it has. Judged from the
    // settled result rather than this render's fetch flags, which can lag a
    // refetch that has just finished and would then load two pages.
    void fetchNextPage({ cancelRefetch: false })
      .then((result) => {
        const joinedRefetch =
          result.isSuccess && (result.data?.pages.length ?? 0) <= loadedPages;
        return joinedRefetch ? fetchNextPage({ cancelRefetch: false }) : undefined;
      })
      .finally(() => setAwaitingPage(false));
  }, [fetchNextPage, hasMore, isLoadingMore, loadedPages]);

  const pagination = useMemo<TaskSurfacePagination>(
    () => ({ loaded, total, hasMore, isLoadingMore, isLoadMoreError, loadMore }),
    [hasMore, isLoadMoreError, isLoadingMore, loadMore, loaded, total],
  );

  const isLoading = !!active && active.isLoading;
  const isRefreshing =
    !!active && active.isFetching && !active.isLoading && !active.isFetchingNextPage;
  // A failed next page keeps the loaded rows and offers retry at the list end;
  // only a failed first load or refetch is an error for the whole surface.
  const isError = !!active && active.isError && !active.isFetchNextPageError;
  const isEmpty = enabled && !isLoading && !isError && loaded === 0 && !hasMore;

  return { surfaceTasks, pagination, isLoading, isRefreshing, isEmpty, isError };
}
