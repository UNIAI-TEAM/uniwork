import type { TableFilter } from "../../api/endpoints/tasks-table";
import { mapStoreToTableFilter } from "../filters/map-store-to-table-filter";
import type {
  FilterSnapshot,
  TaskDateFilter,
} from "../stores/view-store-types";
import type { MyTasksRelation, TaskScope } from "./scope";

export interface SurfaceQueryPlan {
  kind: "workspace_query" | "my_tasks" | "table";
  queryBody?: { status?: string; limit?: number; offset?: number; project_id?: string };
  myTasksOpts?: { relation?: MyTasksRelation; limit?: number; offset?: number };
  /** TableGroupsBody once modes wire filters; null until then. */
  tableBody?: { filter?: TableFilter } | null;
}

/** Store snapshot → TableFilter, locking project scope to the surface project. */
export function buildSurfaceTableFilter(input: {
  scope: TaskScope;
  snapshot: FilterSnapshot;
  dateFilter?: TaskDateFilter | null;
}): TableFilter | undefined {
  const mapped = mapStoreToTableFilter(input.snapshot, {
    lockProjectFilter: input.scope.type === "project",
    dateFilter: input.dateFilter,
  });
  if (input.scope.type === "project") {
    return { ...mapped, project_ids: [input.scope.projectId] };
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mergeTableBodyFilter(
  scope: TaskScope,
  filter: TableFilter | undefined,
): TableFilter | undefined {
  if (scope.type === "project") {
    const { project_ids: _ignored, ...rest } = filter ?? {};
    return { ...rest, project_ids: [scope.projectId] };
  }
  if (!filter || Object.keys(filter).length === 0) return undefined;
  return filter;
}

export function planSurfaceQuery(input: {
  scope: TaskScope;
  viewMode: "board" | "list" | "table" | "gantt" | "swimlane";
  /** Pre-mapped store filter (statuses, etc.); project_ids always overwritten on project scope. */
  filter?: TableFilter;
}): SurfaceQueryPlan {
  // My-scope never plans table: `/tasks/table/*` is workspace-wide today.
  if (input.scope.type === "my") {
    return {
      kind: "my_tasks",
      myTasksOpts: { relation: input.scope.relation },
    };
  }

  if (input.scope.type === "project") {
    const projectId = input.scope.projectId;
    if (input.viewMode === "table") {
      const filter = mergeTableBodyFilter(input.scope, input.filter);
      return {
        kind: "table",
        tableBody: { filter },
      };
    }
    return {
      kind: "workspace_query",
      queryBody: { project_id: projectId },
    };
  }

  if (input.viewMode === "table") {
    const filter = mergeTableBodyFilter(input.scope, input.filter);
    return {
      kind: "table",
      tableBody: filter ? { filter } : null,
    };
  }

  return { kind: "workspace_query", queryBody: {} };
}
