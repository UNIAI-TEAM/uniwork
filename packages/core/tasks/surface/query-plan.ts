import type { MyTasksRelation, TaskScope } from "./scope";

export interface SurfaceQueryPlan {
  kind: "workspace_query" | "my_tasks" | "table";
  queryBody?: { status?: string; limit?: number; offset?: number };
  myTasksOpts?: { relation?: MyTasksRelation; limit?: number; offset?: number };
  /** TableGroupsBody | null until modes wire facets. */
  tableBody?: unknown;
}

export function planSurfaceQuery(input: {
  scope: TaskScope;
  viewMode: "board" | "list" | "table" | "gantt" | "swimlane";
}): SurfaceQueryPlan {
  if (input.scope.type === "my") {
    return {
      kind: "my_tasks",
      myTasksOpts: { relation: input.scope.relation },
    };
  }

  if (input.viewMode === "table") {
    return { kind: "table", tableBody: null };
  }

  return { kind: "workspace_query", queryBody: {} };
}
