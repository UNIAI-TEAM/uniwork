import { useMemo } from "react";
import type { TableFacetsResult } from "@uniwork/core/api/endpoints/tasks-table";
import type { TaskViewBaseline } from "@uniwork/core/tasks/views/baseline";
import { actorFilterKey } from "@uniwork/core/tasks/views/baseline";
import type {
  ActorFilterValue,
  FilterSnapshot,
  TaskDateFilter,
} from "@uniwork/core/tasks/stores/view-store-types";
import type { Task } from "@uniwork/core/types";

export type TaskTableFacetSpec =
  | {
      kind:
        | "status"
        | "priority"
        | "assignee"
        | "creator"
        | "project"
        | "label";
    }
  | { kind: "property"; property_id: string };

/** Facet kinds accepted by POST .../tasks/table/facets. */
export const SERVER_TABLE_FACET_KINDS = [
  "status",
  "priority",
  "assignee",
  "project",
] as const;

export type ServerTableFacetKind = (typeof SERVER_TABLE_FACET_KINDS)[number];

export function isServerTableFacetKind(
  kind: TaskTableFacetSpec["kind"],
): kind is ServerTableFacetKind {
  return (SERVER_TABLE_FACET_KINDS as readonly string[]).includes(kind);
}

export interface FilterCountMaps {
  status: Map<string, number>;
  priority: Map<string, number>;
  assignee: Map<string, number>;
  creator: Map<string, number>;
  project: Map<string, number>;
  label: Map<string, number>;
  property: Map<string, Map<string, number>>;
  noAssignee: number;
  noProject: number;
}

export function getActiveFilterCount(
  state: FilterSnapshot & { dateFilter?: TaskDateFilter | null },
  baseline?: TaskViewBaseline,
  lockProjectFilter = false,
): number {
  let count = 0;
  const delta = (values: string[], fixed?: Set<string>) =>
    fixed ? values.filter((v) => !fixed.has(v)).length : values.length;

  if (delta(state.statusFilters, baseline?.status) > 0) count += 1;
  if (delta(state.priorityFilters, baseline?.priority) > 0) count += 1;

  const assigneeDelta =
    delta(state.assigneeFilters.map(actorFilterKey), baseline?.assignee) > 0 ||
    (state.includeNoAssignee && !(baseline?.includeNoAssignee ?? false));
  if (assigneeDelta) count += 1;

  if (delta(state.creatorFilters.map(actorFilterKey), baseline?.creator) > 0) {
    count += 1;
  }

  if (!lockProjectFilter) {
    const projectDelta =
      delta(state.projectFilters, baseline?.project) > 0 ||
      (state.includeNoProject && !(baseline?.includeNoProject ?? false));
    if (projectDelta) count += 1;
  }

  if (delta(state.labelFilters, baseline?.label) > 0) count += 1;

  for (const [id, selected] of Object.entries(state.propertyFilters ?? {})) {
    if (delta(selected, baseline?.property.get(id)) > 0) count += 1;
  }

  if (state.dateFilter) count += 1;
  return count;
}

function emptyCounts(): FilterCountMaps {
  return {
    status: new Map(),
    priority: new Map(),
    assignee: new Map(),
    creator: new Map(),
    project: new Map(),
    label: new Map(),
    property: new Map(),
    noAssignee: 0,
    noProject: 0,
  };
}

/** Prefer server facets when present; otherwise tally loaded tasks (ids only). */
export function useTaskFilterCounts(
  scopedTasks: Task[],
  serverFacets?: TableFacetsResult,
): FilterCountMaps {
  return useMemo(() => {
    if (serverFacets) {
      const counts = emptyCounts();
      for (const facet of serverFacets.facets) {
        const target =
          facet.kind === "status"
            ? counts.status
            : facet.kind === "priority"
              ? counts.priority
              : facet.kind === "assignee"
                ? counts.assignee
                : facet.kind === "creator"
                  ? counts.creator
                  : facet.kind === "project"
                    ? counts.project
                    : facet.kind === "label"
                      ? counts.label
                      : null;
        if (!target) continue;
        for (const value of facet.values) {
          if (facet.kind === "assignee" && value.key === "__none__") {
            counts.noAssignee = value.count;
          } else if (facet.kind === "project" && value.key === "__none__") {
            counts.noProject = value.count;
          } else {
            target.set(value.key, value.count);
          }
        }
      }
      return counts;
    }

    const counts = emptyCounts();
    for (const task of scopedTasks) {
      counts.status.set(task.status, (counts.status.get(task.status) ?? 0) + 1);
      counts.priority.set(
        task.priority,
        (counts.priority.get(task.priority) ?? 0) + 1,
      );

      if (!task.assignee_id) {
        counts.noAssignee += 1;
      } else {
        const kind = task.assignee_kind === "agent" ? "agent" : "member";
        const key = `${kind}:${task.assignee_id}`;
        counts.assignee.set(key, (counts.assignee.get(key) ?? 0) + 1);
      }

      const creatorKind = task.created_by_kind === "agent" ? "agent" : "member";
      const cKey = `${creatorKind}:${task.created_by}`;
      counts.creator.set(cKey, (counts.creator.get(cKey) ?? 0) + 1);

      if (!task.project_id) {
        counts.noProject += 1;
      } else {
        counts.project.set(
          task.project_id,
          (counts.project.get(task.project_id) ?? 0) + 1,
        );
      }
    }
    return counts;
  }, [scopedTasks, serverFacets]);
}

export function actorChecked(
  values: ActorFilterValue[],
  value: ActorFilterValue,
): boolean {
  return values.some(({ type, id }) => type === value.type && id === value.id);
}
