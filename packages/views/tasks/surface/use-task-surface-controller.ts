"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TableFacetsResult } from "@uniwork/core/api/endpoints/tasks-table";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import {
  taskKeys,
  useGroupedTasks,
  useTableFacets,
  useTaskStatuses,
  useUpdateTask,
} from "@uniwork/core/tasks";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { planSurfaceQuery } from "@uniwork/core/tasks/surface/query-plan";
import { taskScopeKey, type TaskScope } from "@uniwork/core/tasks/surface/scope";
import { TASK_STATUSES, type Task, type TaskStatus } from "@uniwork/core/types";
import {
  type TaskTableFacetSpec,
} from "../modes/table-view-model";
import {
  type TaskCreateDefaults,
  type TaskSurfaceActions,
  type TaskSurfaceMutationOptions,
} from "./actions-context";
import {
  useCreateTaskSurfaceSelection,
  type TaskSurfaceSelection,
} from "./selection-context";
import type { TaskSurfaceMode } from "./types";
import { useTaskSurfaceData } from "./use-task-surface-data";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

export interface TaskSurfaceController {
  scopeKey: string;
  viewMode: TaskSurfaceMode;
  setViewMode: (mode: TaskSurfaceMode) => void;
  surfaceTasks: Task[];
  /** Ordered status-category keys for board columns (catalog / seven built-ins). */
  boardCategories: readonly string[];
  projectGroupingDisabled: boolean;
  projectGroupingReasonKey: string;
  /** Open filter-submenu facet for table (and grouped) surfaces. */
  activeTableFacet: TaskTableFacetSpec | null;
  setActiveTableFacet: (facet: TaskTableFacetSpec | null) => void;
  tableFacetCounts: TableFacetsResult | undefined;
  isLoading: boolean;
  isEmpty: boolean;
  isRefreshing: boolean;
  actions: TaskSurfaceActions;
  selection: TaskSurfaceSelection;
  openCreateTask: (defaults?: TaskCreateDefaults) => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}

function orderBoardCategories(raw: string[]): string[] {
  if (raw.length === 0) return [...TASK_STATUSES];
  const known = new Set(TASK_STATUSES);
  const ordered = TASK_STATUSES.filter((category) => raw.includes(category));
  const extras = raw.filter((category) => !known.has(category as TaskStatus));
  return [...ordered, ...extras];
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
  const queryClient = useQueryClient();

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

  const boardEnabled = effectiveViewMode === "board";
  const tableEnabled = effectiveViewMode === "table";
  const listQueryEnabled =
    (effectiveViewMode === "list" || effectiveViewMode === "swimlane") &&
    queryPlan.kind !== "table";

  const data = useTaskSurfaceData({
    workspaceId,
    queryPlan,
    enabled: listQueryEnabled,
  });

  const statusesQuery = useTaskStatuses(boardEnabled ? workspaceId : "");
  const groupedQuery = useGroupedTasks(boardEnabled ? workspaceId : "", {
    group_by: "status",
  });
  const updateTask = useUpdateTask(workspaceId);
  const { data: publicConfig } = usePublicConfig();

  const [activeTableFacet, setActiveTableFacetState] =
    useState<TaskTableFacetSpec | null>(null);

  useEffect(() => {
    if (!tableEnabled) setActiveTableFacetState(null);
  }, [tableEnabled]);

  const setActiveTableFacet = useCallback(
    (facet: TaskTableFacetSpec | null) => {
      setActiveTableFacetState(tableEnabled ? facet : null);
    },
    [tableEnabled],
  );

  const facetsBody = useMemo(() => {
    if (!tableEnabled || !activeTableFacet) return null;
    return {
      filter: undefined,
      facets: [activeTableFacet.kind],
      columns: undefined,
    };
  }, [activeTableFacet, tableEnabled]);

  const facetsQuery = useTableFacets(tableEnabled ? workspaceId : "", facetsBody);

  const boardCategories = useMemo(() => {
    const catalog = statusesQuery.data;
    const fromCategories = catalog?.categories ?? [];
    const fromStatuses = [
      ...new Set((catalog?.statuses ?? []).map((row) => row.category)),
    ];
    return orderBoardCategories(
      fromCategories.length > 0 ? fromCategories : fromStatuses,
    );
  }, [statusesQuery.data]);

  const boardTasks = useMemo(() => {
    if (!boardEnabled) return data.surfaceTasks;
    const groups = groupedQuery.data ?? [];
    return groups.flatMap((group) => group.tasks);
  }, [boardEnabled, data.surfaceTasks, groupedQuery.data]);

  const projectsCapability = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.projects",
  );
  const projectGroupingDisabled = projectsCapability.status !== "available";
  const projectGroupingReasonKey =
    projectsCapability.explanation_key || "capabilities.unknown";

  const scopeKey = taskScopeKey(scope);
  const selection = useCreateTaskSurfaceSelection(
    `${workspaceId}:${scopeKey}:${effectiveViewMode}`,
  );

  const [createOpen, setCreateOpen] = useState(false);

  const openCreateTask = useCallback((_defaults?: TaskCreateDefaults) => {
    setCreateOpen(true);
  }, []);

  const moveTask = useCallback(
    (
      taskId: string,
      updates: Record<string, unknown>,
      options?: TaskSurfaceMutationOptions,
    ) => {
      const status =
        typeof updates.status === "string" ? updates.status : undefined;
      const position =
        typeof updates.position === "number" ? updates.position : undefined;
      if (status === undefined && position === undefined) return;
      updateTask.mutate(
        {
          taskId,
          patch: {
            ...(status !== undefined ? { status: status as TaskStatus } : {}),
            ...(position !== undefined ? { position } : {}),
          },
        },
        {
          onSuccess: (task) => {
            if (task) options?.onSuccess?.(task);
          },
          onError: (err) => options?.onError?.(err),
          onSettled: () => {
            void queryClient.invalidateQueries({
              queryKey: taskKeys.groupedRoot(workspaceId),
            });
            options?.onSettled?.();
          },
        },
      );
    },
    [queryClient, updateTask, workspaceId],
  );

  const actions = useMemo<TaskSurfaceActions>(
    () => ({
      isPending: updateTask.isPending,
      createTask: (defaults) => openCreateTask(defaults),
      updateTask: () => {},
      moveTask,
      batchUpdate: async () => {},
      batchDelete: async () => {},
    }),
    [moveTask, openCreateTask, updateTask.isPending],
  );

  const setViewMode = useCallback(
    (mode: TaskSurfaceMode) => {
      if (allowedModes.has(mode)) setViewModeStore(mode);
    },
    [allowedModes, setViewModeStore],
  );

  const isLoading = boardEnabled
    ? statusesQuery.isLoading || groupedQuery.isLoading
    : tableEnabled
      ? false
      : data.isLoading;
  const isRefreshing = boardEnabled
    ? (statusesQuery.isFetching && !statusesQuery.isLoading) ||
      (groupedQuery.isFetching && !groupedQuery.isLoading)
    : tableEnabled
      ? false
      : data.isRefreshing;
  const surfaceTasks = boardEnabled ? boardTasks : data.surfaceTasks;
  // Table owns its empty state inside TableView (groups total). Surface empty
  // only for list/board list-shaped windows.
  const isEmpty =
    (boardEnabled || listQueryEnabled) &&
    !isLoading &&
    surfaceTasks.length === 0;

  return {
    scopeKey,
    viewMode: effectiveViewMode,
    setViewMode,
    surfaceTasks,
    boardCategories,
    projectGroupingDisabled,
    projectGroupingReasonKey,
    activeTableFacet,
    setActiveTableFacet,
    tableFacetCounts:
      tableEnabled && activeTableFacet !== null
        ? facetsQuery.data
        : undefined,
    isLoading,
    isEmpty,
    isRefreshing,
    actions,
    selection,
    openCreateTask,
    createOpen,
    setCreateOpen,
  };
}
