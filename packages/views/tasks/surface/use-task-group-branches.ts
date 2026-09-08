"use client";

import { useMemo } from "react";
import type { Task } from "@uniwork/core/types";

/**
 * Server-backed swimlane branch window (`useTaskGroupBranches`).
 * Suite table groups lack compound secondary status buckets yet, so the hook
 * stays disabled and SwimlaneView builds lanes client-side from surface tasks.
 * Keep this surface shape so later work can flip `enabled` when compound
 * groups land.
 */
export interface TaskGroupPageState {
  total: number;
  loaded: number;
  hasMore: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  loadMore: () => void;
  retry: () => void;
}

export interface TaskGroupBranches {
  enabled: boolean;
  descriptors: Array<{
    key: string;
    value: { kind: string; status?: string };
    count: number;
    secondary_groups?: Array<{
      key: string;
      value: { kind: string; status?: string };
      count: number;
    }>;
  }>;
  tasks: Task[];
  pagination: Record<string, TaskGroupPageState>;
  total: number;
  isLoading: boolean;
  isRefreshing: boolean;
  isError: boolean;
  hasMoreGroups: boolean;
  isLoadingMoreGroups: boolean;
  loadMoreGroups: () => void;
  retryGroups: () => void;
}

const NOOP = () => {};

export function useTaskGroupBranches({
  enabled,
}: {
  workspaceId: string;
  enabled: boolean;
}): TaskGroupBranches {
  return useMemo(
    () => ({
      enabled,
      descriptors: [],
      tasks: [],
      pagination: {},
      total: 0,
      isLoading: false,
      isRefreshing: false,
      isError: false,
      hasMoreGroups: false,
      isLoadingMoreGroups: false,
      loadMoreGroups: NOOP,
      retryGroups: NOOP,
    }),
    [enabled],
  );
}
