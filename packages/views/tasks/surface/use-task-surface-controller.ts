"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { planSurfaceQuery } from "@uniwork/core/tasks/surface/query-plan";
import { taskScopeKey, type TaskScope } from "@uniwork/core/tasks/surface/scope";
import type { Task } from "@uniwork/core/types";
import {
  type TaskCreateDefaults,
  type TaskSurfaceActions,
} from "./actions-context";
import {
  useCreateTaskSurfaceSelection,
  type TaskSurfaceSelection,
} from "./selection-context";
import type { TaskSurfaceMode } from "./types";
import { useTaskSurfaceData } from "./use-task-surface-data";

export interface TaskSurfaceController {
  scopeKey: string;
  viewMode: TaskSurfaceMode;
  setViewMode: (mode: TaskSurfaceMode) => void;
  surfaceTasks: Task[];
  isLoading: boolean;
  isEmpty: boolean;
  isRefreshing: boolean;
  actions: TaskSurfaceActions;
  selection: TaskSurfaceSelection;
  openCreateTask: (defaults?: TaskCreateDefaults) => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}

export function useTaskSurfaceController({
  workspaceId,
  scope,
  modes,
}: {
  workspaceId: string;
  scope: TaskScope;
  modes: TaskSurfaceMode[];
}): TaskSurfaceController {
  const viewMode = useViewStore((s) => s.viewMode);
  const setViewModeStore = useViewStore((s) => s.setViewMode);

  const allowedModes = useMemo(() => new Set<TaskSurfaceMode>(modes), [modes]);
  const fallbackMode = modes[0] ?? "list";
  const effectiveViewMode = allowedModes.has(viewMode as TaskSurfaceMode)
    ? (viewMode as TaskSurfaceMode)
    : fallbackMode;

  useEffect(() => {
    if (!allowedModes.has(viewMode as TaskSurfaceMode)) {
      setViewModeStore(fallbackMode);
    }
  }, [allowedModes, fallbackMode, setViewModeStore, viewMode]);

  const queryPlan = useMemo(
    () => planSurfaceQuery({ scope, viewMode: effectiveViewMode }),
    [effectiveViewMode, scope],
  );

  const listEnabled =
    effectiveViewMode === "list" ||
    effectiveViewMode === "board" ||
    effectiveViewMode === "swimlane";

  const data = useTaskSurfaceData({
    workspaceId,
    queryPlan,
    enabled: listEnabled && queryPlan.kind !== "table",
  });

  const scopeKey = taskScopeKey(scope);
  const selection = useCreateTaskSurfaceSelection(
    `${workspaceId}:${scopeKey}:${effectiveViewMode}`,
  );

  const [createOpen, setCreateOpen] = useState(false);

  const openCreateTask = useCallback((_defaults?: TaskCreateDefaults) => {
    setCreateOpen(true);
  }, []);

  const actions = useMemo<TaskSurfaceActions>(
    () => ({
      isPending: false,
      createTask: (defaults) => openCreateTask(defaults),
      updateTask: () => {},
      moveTask: () => {},
      batchUpdate: async () => {},
      batchDelete: async () => {},
    }),
    [openCreateTask],
  );

  const setViewMode = useCallback(
    (mode: TaskSurfaceMode) => {
      if (allowedModes.has(mode)) setViewModeStore(mode);
    },
    [allowedModes, setViewModeStore],
  );

  return {
    scopeKey,
    viewMode: effectiveViewMode,
    setViewMode,
    surfaceTasks: data.surfaceTasks,
    isLoading: data.isLoading,
    isEmpty: data.isEmpty,
    isRefreshing: data.isRefreshing,
    actions,
    selection,
    openCreateTask,
    createOpen,
    setCreateOpen,
  };
}
