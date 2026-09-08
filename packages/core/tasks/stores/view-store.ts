"use client";

import { useEffect, useRef } from "react";
import { create } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
} from "../../platform/workspace-storage";
import { defaultStorage } from "../../platform/storage";
import { viewFilterSlice, type ViewFilterFields } from "./view-store-filters";
import { viewDisplaySlice, type ViewDisplayFields } from "./view-store-gantt";
import type {
  SortDirection,
  SortField,
  TableColumnConfig,
  TaskGrouping,
  TaskViewMode,
} from "./view-store-types";

export type {
  ActorFilterValue,
  CardProperties,
  FilterDimension,
  FilterSnapshot,
  GanttZoom,
  SortDirection,
  SortField,
  StaticSortField,
  StaticTaskGrouping,
  SwimlaneGrouping,
  TableCalculation,
  TableColumnConfig,
  TableColumnKey,
  TableGrouping,
  TableSystemColumnKey,
  TaskDateField,
  TaskDateFilter,
  TaskGrouping,
  TaskStatusKey,
  TaskViewMode,
} from "./view-store-types";

export {
  CARD_PROPERTY_OPTIONS,
  DEFAULT_TABLE_COLUMNS,
  GROUPING_OPTIONS,
  PROPERTY_VIEW_PREFIX,
  SORT_OPTIONS,
  SWIMLANE_GROUPINGS,
  TABLE_SYSTEM_COLUMNS,
  propertyIdFromViewKey,
} from "./view-store-types";

export interface TaskViewState extends ViewFilterFields, ViewDisplayFields {
  viewMode: TaskViewMode;
  grouping: TaskGrouping;
  sortBy: SortField;
  sortDirection: SortDirection;
  setViewMode: (mode: TaskViewMode) => void;
  setGrouping: (grouping: TaskGrouping) => void;
  setSortBy: (field: SortField) => void;
  setSortDirection: (dir: SortDirection) => void;
}

/** Alias used by surface registry APIs. */
export type SurfaceViewState = TaskViewState;

export const viewStoreSlice = (
  set: StoreApi<TaskViewState>["setState"],
): TaskViewState => ({
  ...viewFilterSlice(set as StoreApi<ViewFilterFields>["setState"]),
  ...viewDisplaySlice(set as StoreApi<ViewDisplayFields>["setState"]),
  viewMode: "board",
  grouping: "status",
  sortBy: "position",
  sortDirection: "asc",
  setViewMode: (mode) => set({ viewMode: mode }),
  setGrouping: (grouping) => set({ grouping }),
  setSortBy: (field) => set({ sortBy: field }),
  setSortDirection: (dir) => set({ sortDirection: dir }),
});

export const viewStorePersistOptions = (name: string) => ({
  name,
  storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
  partialize: (state: TaskViewState) => ({
    // `agentRunningFilter` and `dateFilter` are intentionally not persisted.
    viewMode: state.viewMode,
    grouping: state.grouping,
    statusFilters: state.statusFilters,
    priorityFilters: state.priorityFilters,
    assigneeFilters: state.assigneeFilters,
    includeNoAssignee: state.includeNoAssignee,
    creatorFilters: state.creatorFilters,
    projectFilters: state.projectFilters,
    includeNoProject: state.includeNoProject,
    labelFilters: state.labelFilters,
    propertyFilters: state.propertyFilters,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    cardProperties: state.cardProperties,
    cardPropertyIds: state.cardPropertyIds,
    showSubIssues: state.showSubIssues,
    listCollapsedStatuses: state.listCollapsedStatuses,
    hiddenStatusCategories: state.hiddenStatusCategories,
    ganttZoom: state.ganttZoom,
    ganttShowCompleted: state.ganttShowCompleted,
    swimlaneGrouping: state.swimlaneGrouping,
    swimlaneOrders: state.swimlaneOrders,
    collapsedSwimlanes: state.collapsedSwimlanes,
    tableColumns: state.tableColumns,
    tableGrouping: state.tableGrouping,
    tableCollapsedGroups: state.tableCollapsedGroups,
    tableCollapsedParents: state.tableCollapsedParents,
    tableHierarchy: state.tableHierarchy,
    tableCalculation: state.tableCalculation,
  }),
  merge: mergeViewStatePersisted,
});

/**
 * Reusable persist `merge` for view-state stores. Generic over T so the same
 * deep-merge for `cardProperties` works for both the tasks view store and
 * the my-tasks view store.
 */
export function mergeViewStatePersisted<T extends TaskViewState>(
  persisted: unknown,
  current: T,
): T {
  const p = (persisted ?? {}) as Partial<T>;
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  const persistedTableColumns = Array.isArray(p.tableColumns)
    ? p.tableColumns.filter(
        (column): column is TableColumnConfig =>
          !!column &&
          typeof column === "object" &&
          typeof (column as TableColumnConfig).key === "string",
      )
    : current.tableColumns;
  const dedupedTableColumns = Array.from(
    new Map(persistedTableColumns.map((column) => [column.key, column])).values(),
  ).filter((column) => column.key !== "title");
  const persistedTitle = persistedTableColumns.find(
    (column) => column.key === "title",
  );
  return {
    ...current,
    ...p,
    cardProperties: {
      ...current.cardProperties,
      ...(p.cardProperties ?? {}),
    },
    swimlaneOrders: isRecord(p.swimlaneOrders)
      ? { ...current.swimlaneOrders, ...p.swimlaneOrders }
      : current.swimlaneOrders,
    collapsedSwimlanes: isRecord(p.collapsedSwimlanes)
      ? { ...current.collapsedSwimlanes, ...p.collapsedSwimlanes }
      : current.collapsedSwimlanes,
    tableColumns: [
      persistedTitle ?? current.tableColumns[0] ?? { key: "title" },
      ...dedupedTableColumns,
    ],
    tableCollapsedGroups: Array.isArray(p.tableCollapsedGroups)
      ? p.tableCollapsedGroups
      : current.tableCollapsedGroups,
    tableCollapsedParents: Array.isArray(p.tableCollapsedParents)
      ? p.tableCollapsedParents
      : current.tableCollapsedParents,
  };
}

/** Factory: creates a vanilla StoreApi for use with React Context. */
export function createTaskViewStore(
  persistKey: string,
): StoreApi<TaskViewState> {
  const store = createStore<TaskViewState>()(
    persist(viewStoreSlice, viewStorePersistOptions(persistKey)),
  );
  registerForWorkspaceRehydration(() => {
    void store.persist.rehydrate();
  });
  return store;
}

/** Global singleton for the /tasks page. */
export const useTaskViewStore = create<TaskViewState>()(
  persist(viewStoreSlice, viewStorePersistOptions("uniwork_tasks_view")),
);

registerForWorkspaceRehydration(() => {
  void useTaskViewStore.persist.rehydrate();
});

/**
 * Clears the given view store's filters whenever the workspace id changes.
 *
 * URL-driven: wsId arrives from `useWorkspaceId()` (Context fed by the
 * `[workspaceSlug]` route). We track the previous id via ref so the first
 * render doesn't wipe persisted filters — clearing only fires on transitions
 * from one defined workspace to another.
 */
export function useClearFiltersOnWorkspaceChange(
  store: StoreApi<TaskViewState> | { getState: () => TaskViewState },
  wsId: string | undefined,
) {
  const prevIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevIdRef.current && wsId && wsId !== prevIdRef.current) {
      store.getState().clearFilters();
    }
    prevIdRef.current = wsId;
  }, [wsId, store]);
}
