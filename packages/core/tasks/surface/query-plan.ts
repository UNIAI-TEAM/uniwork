import type { MyTasksRelation, TaskScope } from "./scope";

export interface SurfaceQueryPlan {
  kind: "workspace_query" | "my_tasks" | "table";
  queryBody?: { status?: string; limit?: number; offset?: number; project_id?: string };
  myTasksOpts?: { relation?: MyTasksRelation; limit?: number; offset?: number };
  /** TableGroupsBody once modes wire filters; null until then. */
  tableBody?: { filter?: { project_ids?: string[] } } | null;
}

export function planSurfaceQuery(input: {
  scope: TaskScope;
  viewMode: "board" | "list" | "table" | "gantt" | "swimlane";
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
      return {
        kind: "table",
        tableBody: { filter: { project_ids: [projectId] } },
      };
    }
    return {
      kind: "workspace_query",
      queryBody: { project_id: projectId },
    };
  }

  if (input.viewMode === "table") {
    return { kind: "table", tableBody: null };
  }

  return { kind: "workspace_query", queryBody: {} };
}
