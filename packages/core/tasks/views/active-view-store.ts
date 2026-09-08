"use client";

import { create } from "zustand";
import type { FilterDimension } from "../stores/view-store-types";

export type TaskViewScope = {
  scope_type: "workspace" | "my" | "project";
  scope_id?: string | null;
};

export function taskViewContainerKey(wsId: string, scope: TaskViewScope): string {
  return scope.scope_id
    ? `${wsId}:${scope.scope_type}:${scope.scope_id}`
    : `${wsId}:${scope.scope_type}`;
}

interface ActiveTaskViewState {
  active: Record<string, string>;
  setActive: (containerKey: string, viewId: string | null) => void;
}

export const useActiveTaskViewStore = create<ActiveTaskViewState>((set) => ({
  active: {},
  setActive: (containerKey, viewId) =>
    set((state) => {
      const active = { ...state.active };
      if (viewId) active[containerKey] = viewId;
      else delete active[containerKey];
      return { active };
    }),
}));

export function lockedDimensionsFromQuery(
  query: Record<string, unknown>,
): Set<FilterDimension> {
  const locked = new Set<FilterDimension>();
  const nonEmptyArray = (v: unknown) => Array.isArray(v) && v.length > 0;
  if (nonEmptyArray(query.statusFilters)) locked.add("status");
  if (nonEmptyArray(query.priorityFilters)) locked.add("priority");
  if (nonEmptyArray(query.assigneeFilters) || query.includeNoAssignee === true) {
    locked.add("assignee");
  }
  if (nonEmptyArray(query.creatorFilters)) locked.add("creator");
  if (nonEmptyArray(query.projectFilters) || query.includeNoProject === true) {
    locked.add("project");
  }
  if (nonEmptyArray(query.labelFilters)) locked.add("label");
  const propertyFilters = query.propertyFilters;
  if (propertyFilters && typeof propertyFilters === "object") {
    for (const [id, selected] of Object.entries(
      propertyFilters as Record<string, unknown>,
    )) {
      if (nonEmptyArray(selected)) locked.add(`property:${id}`);
    }
  }
  return locked;
}
