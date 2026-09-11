"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  TableFacetsResult,
  TableFilter,
} from "@uniwork/core/api/endpoints/tasks-table";
import type { TaskPatch } from "@uniwork/core/api/endpoints/tasks";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import {
  taskKeys,
  useBatchDeleteTasks,
  useBatchUpdateTasks,
  useGroupedTasks,
  useTableFacets,
  useTaskStatuses,
  useUpdateTask,
} from "@uniwork/core/tasks";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { planSurfaceQuery } from "@uniwork/core/tasks/surface/query-plan";
import { taskScopeKey, type TaskScope } from "@uniwork/core/tasks/surface/scope";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "@uniwork/core/types";
import type { ActorKind } from "@uniwork/core/types/audit";
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
import { projectSurfaceTasks } from "./task-surface-projection";
import { useTaskSurfaceData } from "./use-task-surface-data";
import { useTaskGroupBranches } from "./use-task-group-branches";
import { ganttCanvasRows } from "../modes/gantt-canvas";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

const EMPTY_TASKS: Task[] = [];

function taskPatchFromSurfaceUpdates(
  updates: Record<string, unknown>,
): TaskPatch {
  const patch: TaskPatch = {};
  if (typeof updates.title === "string") patch.title = updates.title;
  if (typeof updates.description === "string") {
    patch.description = updates.description;
  }
  if (
    typeof updates.status === "string" &&
    TASK_STATUSES.includes(updates.status as TaskStatus)
  ) {
    patch.status = updates.status as TaskStatus;
  }
  if (
    typeof updates.priority === "string" &&
    TASK_PRIORITIES.includes(updates.priority as TaskPriority)
  ) {
    patch.priority = updates.priority as TaskPriority;
  }
  if (typeof updates.position === "number") patch.position = updates.position;
  if (
    updates.assignee_id === null ||
    typeof updates.assignee_id === "string"
  ) {
    patch.assignee_id = updates.assignee_id;
    if (
      updates.assignee_kind === "human" ||
      updates.assignee_kind === "agent" ||
      updates.assignee_kind === "system"
    ) {
      patch.assignee_kind = updates.assignee_kind;
    }
  }
  if (updates.due_date === null || typeof updates.due_date === "string") {
    patch.due_date = updates.due_date;
  }
  return patch;
}

export interface TaskSurfaceController {
  scopeKey: string;
  viewMode: TaskSurfaceMode;
  setViewMode: (mode: TaskSurfaceMode) => void;
  surfaceTasks: Task[];
  /** Gantt canvas projection (dated ± showCompleted). Empty ≠ surface empty. */
  ganttTasks: Task[];
  /** Ordered status-category keys for board columns (catalog / seven built-ins). */
  boardCategories: readonly string[];
  /** Table groups/rows/facets filter from planSurfaceQuery (e.g. project_ids). */
  tableFilter: TableFilter | undefined;
  projectGroupingDisabled: boolean;
  projectGroupingReasonKey: string;
  parentGroupingDisabled: boolean;
  parentGroupingReasonKey: string;
  groupBranches: ReturnType<typeof useTaskGroupBranches>;
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

  // My-scope must never mount workspace table groups/rows (no relation filter).
  const allowedModes = useMemo(() => {
    const next = new Set<TaskSurfaceMode>(modes);
    if (scope.type === "my") next.delete("table");
    return next;
  }, [modes, scope.type]);
  const fallbackMode =
    (modes.find((mode) => allowedModes.has(mode)) as TaskSurfaceMode | undefined) ??
    "list";
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
  const tableFilter = queryPlan.tableBody?.filter;

  const boardEnabled = effectiveViewMode === "board";
  const tableEnabled = effectiveViewMode === "table" && scope.type !== "my";
  const ganttEnabled = effectiveViewMode === "gantt";
  const swimlaneEnabled = effectiveViewMode === "swimlane";
  // My-scope board has no relation-aware grouped endpoint yet — feed the
  // board from listMyTasks so columns never show other people's work.
  const myBoardUsesList = boardEnabled && scope.type === "my";
  const listQueryEnabled =
    (effectiveViewMode === "list" ||
      swimlaneEnabled ||
      ganttEnabled ||
      myBoardUsesList) &&
    queryPlan.kind !== "table";

  const data = useTaskSurfaceData({
    workspaceId,
    queryPlan,
    enabled: listQueryEnabled,
  });

  const ganttShowCompleted = useViewStore((s) => s.ganttShowCompleted);
  const showSubTasks = useViewStore((s) => s.showSubTasks);
  const sortBy = useViewStore((s) => s.sortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);

  const groupBranches = useTaskGroupBranches({
    workspaceId,
    enabled: false,
  });

  const statusesQuery = useTaskStatuses(
    boardEnabled || swimlaneEnabled || effectiveViewMode === "list"
      ? workspaceId
      : "",
  );
  const groupedQuery = useGroupedTasks(
    boardEnabled && scope.type !== "my" ? workspaceId : "",
    {
      group_by: "status",
      ...(scope.type === "project" ? { project_id: scope.projectId } : {}),
    },
  );
  const updateTaskMutation = useUpdateTask(workspaceId);
  const batchUpdateTasks = useBatchUpdateTasks(workspaceId);
  const batchDeleteTasks = useBatchDeleteTasks(workspaceId);
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
      filter: tableFilter,
      facets: [activeTableFacet.kind],
      columns: undefined,
    };
  }, [activeTableFacet, tableEnabled, tableFilter]);

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
    if (scope.type === "my") return data.surfaceTasks;
    const groups = groupedQuery.data ?? [];
    return groups.flatMap((group) => group.tasks);
  }, [boardEnabled, data.surfaceTasks, groupedQuery.data, scope.type]);

  const projectsCapability = capabilityState(
    publicConfig ?? EMPTY_CONFIG,
    "tasks.projects",
  );
  const projectGroupingDisabled = projectsCapability.status !== "available";
  const projectGroupingReasonKey =
    projectsCapability.explanation_key || "capabilities.unknown";
  // parent_task_id is part of the suite list DTO, so client-built parent
  // lanes are available even before server-side grouped pagination is wired.
  const parentGroupingDisabled = false;
  const parentGroupingReasonKey = "tasks.swimlane.parent_unavailable";

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
      const assigneeId =
        updates.assignee_id === null || typeof updates.assignee_id === "string"
          ? (updates.assignee_id as string | null)
          : undefined;
      const assigneeKindRaw =
        typeof updates.assignee_kind === "string"
          ? updates.assignee_kind
          : undefined;
      const assigneeKind =
        assigneeKindRaw === "human" ||
        assigneeKindRaw === "agent" ||
        assigneeKindRaw === "system"
          ? (assigneeKindRaw as ActorKind)
          : undefined;
      if (
        status === undefined &&
        position === undefined &&
        assigneeId === undefined
      ) {
        return;
      }
      updateTaskMutation.mutate(
        {
          taskId,
          patch: {
            ...(status !== undefined ? { status: status as TaskStatus } : {}),
            ...(position !== undefined ? { position } : {}),
            ...(assigneeId !== undefined
              ? {
                  assignee_id: assigneeId,
                  ...(assigneeKind !== undefined
                    ? { assignee_kind: assigneeKind }
                    : {}),
                }
              : {}),
          },
        },
        {
          onSuccess: (task) => {
            if (task) options?.onSuccess?.(task);
          },
          onError: (err) => options?.onError?.(err),
          onSettled: () => options?.onSettled?.(),
        },
      );
    },
    [updateTaskMutation],
  );

  const updateSurfaceTask = useCallback(
    (
      taskId: string,
      updates: Record<string, unknown>,
      options?: TaskSurfaceMutationOptions,
    ) => {
      const patch = taskPatchFromSurfaceUpdates(updates);
      if (Object.keys(patch).length === 0) {
        options?.onSettled?.();
        return;
      }
      updateTaskMutation.mutate(
        { taskId, patch },
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
    [queryClient, updateTaskMutation, workspaceId],
  );

  const actions = useMemo<TaskSurfaceActions>(
    () => ({
      isPending:
        updateTaskMutation.isPending ||
        batchUpdateTasks.isPending ||
        batchDeleteTasks.isPending,
      createTask: (defaults) => openCreateTask(defaults),
      updateTask: updateSurfaceTask,
      moveTask,
      batchUpdate: async (taskIds, updates) => {
        await batchUpdateTasks.mutateAsync({
          task_ids: taskIds,
          updates: updates as {
            status?: string;
            priority?: string;
            assignee_id?: string | null;
            assignee_kind?: string;
          },
        });
      },
      batchDelete: async (taskIds) => {
        await batchDeleteTasks.mutateAsync(taskIds);
      },
    }),
    [
      batchDeleteTasks,
      batchUpdateTasks,
      moveTask,
      openCreateTask,
      updateSurfaceTask,
      updateTaskMutation.isPending,
    ],
  );

  const setViewMode = useCallback(
    (mode: TaskSurfaceMode) => {
      if (allowedModes.has(mode)) setViewModeStore(mode);
    },
    [allowedModes, setViewModeStore],
  );

  const isLoading = boardEnabled
    ? scope.type === "my"
      ? data.isLoading || statusesQuery.isLoading
      : statusesQuery.isLoading || groupedQuery.isLoading
    : tableEnabled
      ? false
      : data.isLoading;
  const isRefreshing = boardEnabled
    ? scope.type === "my"
      ? data.isRefreshing ||
        (statusesQuery.isFetching && !statusesQuery.isLoading)
      : (statusesQuery.isFetching && !statusesQuery.isLoading) ||
        (groupedQuery.isFetching && !groupedQuery.isLoading)
    : tableEnabled
      ? false
      : data.isRefreshing;
  const rawSurfaceTasks = boardEnabled ? boardTasks : data.surfaceTasks;
  const surfaceTasks = useMemo(
    () =>
      tableEnabled
        ? rawSurfaceTasks
        : projectSurfaceTasks(rawSurfaceTasks, {
            showSubTasks,
            sortBy,
            sortDirection,
          }),
    [rawSurfaceTasks, showSubTasks, sortBy, sortDirection, tableEnabled],
  );
  const ganttTasks = useMemo(
    () =>
      ganttEnabled
        ? ganttCanvasRows(surfaceTasks, ganttShowCompleted)
        : EMPTY_TASKS,
    [ganttEnabled, ganttShowCompleted, surfaceTasks],
  );
  // isEmpty asserts "this window has no tasks" from the full surface query.
  // Gantt's scheduled subset (ganttTasks) is a projection — undated-only must
  // not mark the surface empty; GanttView owns that empty copy. Zero tasks in
  // the window still surface-empty even in gantt mode.
  // Table owns its own empty state. Swimlane/list/board use the full window.
  const isEmpty =
    !tableEnabled &&
    (boardEnabled || listQueryEnabled) &&
    !isLoading &&
    surfaceTasks.length === 0;

  return {
    scopeKey,
    viewMode: effectiveViewMode,
    setViewMode,
    surfaceTasks,
    ganttTasks,
    boardCategories,
    tableFilter,
    projectGroupingDisabled,
    projectGroupingReasonKey,
    parentGroupingDisabled,
    parentGroupingReasonKey,
    groupBranches,
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
