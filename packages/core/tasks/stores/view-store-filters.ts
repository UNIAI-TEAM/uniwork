"use client";

import type { StoreApi } from "zustand/vanilla";
import type { TaskPriority, TaskStatusCategory } from "../../types/task";
import type {
  ActorFilterValue,
  FilterDimension,
  FilterSnapshot,
  TaskDateFilter,
  TaskStatusKey,
} from "./view-store-types";
import { propertyIdFromViewKey } from "./view-store-types";

/** Filter fields + actions shared by every task view store. */
export interface ViewFilterFields {
  statusFilters: TaskStatusKey[];
  priorityFilters: TaskPriority[];
  assigneeFilters: ActorFilterValue[];
  includeNoAssignee: boolean;
  creatorFilters: ActorFilterValue[];
  projectFilters: string[];
  includeNoProject: boolean;
  labelFilters: string[];
  propertyFilters: Record<string, string[]>;
  dateFilter: TaskDateFilter | null;
  agentRunningFilter: boolean;
  hiddenStatusCategories: TaskStatusCategory[];
  toggleStatusFilter: (status: TaskStatusKey) => void;
  togglePriorityFilter: (priority: TaskPriority) => void;
  toggleAssigneeFilter: (value: ActorFilterValue) => void;
  toggleNoAssignee: () => void;
  toggleCreatorFilter: (value: ActorFilterValue) => void;
  toggleProjectFilter: (projectId: string) => void;
  toggleNoProject: () => void;
  toggleLabelFilter: (labelId: string) => void;
  togglePropertyFilter: (propertyId: string, optionId: string) => void;
  setDateFilter: (filter: TaskDateFilter | null) => void;
  toggleAgentRunningFilter: () => void;
  hideStatus: (category: TaskStatusCategory) => void;
  showStatus: (category: TaskStatusCategory) => void;
  clearFilters: () => void;
  clearFilterDimension: (dimension: FilterDimension) => void;
  resetFiltersTo: (snapshot: FilterSnapshot) => void;
}

type FilterSetState = StoreApi<ViewFilterFields>["setState"];

export function viewFilterSlice(set: FilterSetState): ViewFilterFields {
  return {
    statusFilters: [],
    priorityFilters: [],
    assigneeFilters: [],
    includeNoAssignee: false,
    creatorFilters: [],
    projectFilters: [],
    includeNoProject: false,
    labelFilters: [],
    propertyFilters: {},
    dateFilter: null,
    agentRunningFilter: false,
    hiddenStatusCategories: [],

    toggleStatusFilter: (status) =>
      set((state) => ({
        statusFilters: state.statusFilters.includes(status)
          ? state.statusFilters.filter((s) => s !== status)
          : [...state.statusFilters, status],
      })),
    togglePriorityFilter: (priority) =>
      set((state) => ({
        priorityFilters: state.priorityFilters.includes(priority)
          ? state.priorityFilters.filter((p) => p !== priority)
          : [...state.priorityFilters, priority],
      })),
    toggleAssigneeFilter: (value) =>
      set((state) => {
        const exists = state.assigneeFilters.some(
          (f) => f.type === value.type && f.id === value.id,
        );
        return {
          assigneeFilters: exists
            ? state.assigneeFilters.filter(
                (f) => !(f.type === value.type && f.id === value.id),
              )
            : [...state.assigneeFilters, value],
        };
      }),
    toggleNoAssignee: () =>
      set((state) => ({ includeNoAssignee: !state.includeNoAssignee })),
    toggleCreatorFilter: (value) =>
      set((state) => {
        const exists = state.creatorFilters.some(
          (f) => f.type === value.type && f.id === value.id,
        );
        return {
          creatorFilters: exists
            ? state.creatorFilters.filter(
                (f) => !(f.type === value.type && f.id === value.id),
              )
            : [...state.creatorFilters, value],
        };
      }),
    toggleProjectFilter: (projectId) =>
      set((state) => ({
        projectFilters: state.projectFilters.includes(projectId)
          ? state.projectFilters.filter((id) => id !== projectId)
          : [...state.projectFilters, projectId],
      })),
    toggleNoProject: () =>
      set((state) => ({ includeNoProject: !state.includeNoProject })),
    toggleLabelFilter: (labelId) =>
      set((state) => ({
        labelFilters: state.labelFilters.includes(labelId)
          ? state.labelFilters.filter((id) => id !== labelId)
          : [...state.labelFilters, labelId],
      })),
    togglePropertyFilter: (propertyId, optionId) =>
      set((state) => {
        const current = state.propertyFilters[propertyId] ?? [];
        const next = current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
        const propertyFilters = { ...state.propertyFilters };
        if (next.length === 0) delete propertyFilters[propertyId];
        else propertyFilters[propertyId] = next;
        return { propertyFilters };
      }),
    setDateFilter: (filter) => set({ dateFilter: filter }),
    toggleAgentRunningFilter: () =>
      set((state) => ({ agentRunningFilter: !state.agentRunningFilter })),
    hideStatus: (category) =>
      set((state) =>
        state.hiddenStatusCategories.includes(category)
          ? state
          : {
              hiddenStatusCategories: [
                ...state.hiddenStatusCategories,
                category,
              ],
            },
      ),
    showStatus: (category) =>
      set((state) => ({
        hiddenStatusCategories: state.hiddenStatusCategories.filter(
          (c) => c !== category,
        ),
      })),
    clearFilters: () =>
      set({
        statusFilters: [],
        priorityFilters: [],
        assigneeFilters: [],
        includeNoAssignee: false,
        creatorFilters: [],
        projectFilters: [],
        includeNoProject: false,
        labelFilters: [],
        propertyFilters: {},
        dateFilter: null,
        agentRunningFilter: false,
        hiddenStatusCategories: [],
      }),
    resetFiltersTo: (snapshot) => set({ ...snapshot }),
    clearFilterDimension: (dimension) =>
      set((state) => {
        switch (dimension) {
          case "status":
            return { statusFilters: [] };
          case "priority":
            return { priorityFilters: [] };
          case "assignee":
            return { assigneeFilters: [], includeNoAssignee: false };
          case "creator":
            return { creatorFilters: [] };
          case "project":
            return { projectFilters: [], includeNoProject: false };
          case "label":
            return { labelFilters: [] };
          default: {
            const propertyId = propertyIdFromViewKey(dimension);
            if (!propertyId || !(propertyId in state.propertyFilters)) {
              return state;
            }
            const propertyFilters = { ...state.propertyFilters };
            delete propertyFilters[propertyId];
            return { propertyFilters };
          }
        }
      }),
  };
}
