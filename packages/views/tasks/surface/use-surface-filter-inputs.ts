"use client";

import { useMemo } from "react";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type {
  FilterSnapshot,
  TaskDateFilter,
} from "@uniwork/core/tasks/stores/view-store-types";
import type { TaskFilterState } from "../utils/filter";

/** Stable filter snapshot + client filter state from the surface view store. */
export function useSurfaceFilterInputs(): {
  snapshot: FilterSnapshot;
  dateFilter: TaskDateFilter | null;
  agentRunningFilter: boolean;
  clientFilterState: TaskFilterState;
} {
  const statusFilters = useViewStore((s) => s.statusFilters);
  const priorityFilters = useViewStore((s) => s.priorityFilters);
  const assigneeFilters = useViewStore((s) => s.assigneeFilters);
  const includeNoAssignee = useViewStore((s) => s.includeNoAssignee);
  const creatorFilters = useViewStore((s) => s.creatorFilters);
  const projectFilters = useViewStore((s) => s.projectFilters);
  const includeNoProject = useViewStore((s) => s.includeNoProject);
  const labelFilters = useViewStore((s) => s.labelFilters);
  const propertyFilters = useViewStore((s) => s.propertyFilters);
  const dateFilter = useViewStore((s) => s.dateFilter);
  const agentRunningFilter = useViewStore((s) => s.agentRunningFilter);

  const snapshot = useMemo<FilterSnapshot>(
    () => ({
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
      labelFilters,
      propertyFilters,
    }),
    [
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
      labelFilters,
      propertyFilters,
    ],
  );

  const clientFilterState = useMemo<TaskFilterState>(
    () => ({
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
      labelFilters,
      propertyFilters,
      workingOnly: agentRunningFilter,
    }),
    [
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
      labelFilters,
      propertyFilters,
      agentRunningFilter,
    ],
  );

  return { snapshot, dateFilter, agentRunningFilter, clientFilterState };
}
