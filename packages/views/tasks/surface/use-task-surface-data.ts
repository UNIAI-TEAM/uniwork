"use client";

import { useMemo } from "react";
import { useMyTasks, useQueryTasks } from "@uniwork/core/tasks";
import type { SurfaceQueryPlan } from "@uniwork/core/tasks/surface/query-plan";
import type { Task } from "@uniwork/core/types";

const EMPTY_TASKS: Task[] = [];

export interface TaskSurfaceData {
  surfaceTasks: Task[];
  isLoading: boolean;
  isRefreshing: boolean;
  isEmpty: boolean;
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
  const workspaceQuery = useQueryTasks(
    useWorkspace ? workspaceId : "",
    queryPlan.queryBody ?? {},
  );
  const myTasksQuery = useMyTasks(
    useMy ? workspaceId : "",
    queryPlan.myTasksOpts ?? {},
  );

  const active = useMy ? myTasksQuery : useWorkspace ? workspaceQuery : null;

  const surfaceTasks = useMemo(() => {
    if (!active) return EMPTY_TASKS;
    if (useMy) return (myTasksQuery.data?.tasks ?? EMPTY_TASKS) as Task[];
    if (useWorkspace) return (workspaceQuery.data?.tasks ?? EMPTY_TASKS) as Task[];
    return EMPTY_TASKS;
  }, [active, myTasksQuery.data, useMy, useWorkspace, workspaceQuery.data]);

  const isLoading = !!active && active.isLoading;
  const isRefreshing = !!active && active.isFetching && !active.isLoading;
  const isEmpty = enabled && !isLoading && surfaceTasks.length === 0;

  return { surfaceTasks, isLoading, isRefreshing, isEmpty };
}
