export type TaskActorKind = "all" | "members" | "agents";
export type MyTasksRelation = "all" | "assigned" | "created" | "involved";

export type TaskScope =
  | { type: "workspace"; actorKind?: TaskActorKind }
  | { type: "my"; userId: string; relation: MyTasksRelation }
  | { type: "project"; projectId: string };

export function taskScopeKey(scope: TaskScope): string {
  switch (scope.type) {
    case "workspace":
      return `workspace:${scope.actorKind ?? "all"}`;
    case "my":
      return `my:${scope.userId}:${scope.relation}`;
    case "project":
      return `project:${scope.projectId}`;
  }
}

/** Saved-view scope_variant → my-scope relation. Unknown/absent means "all". */
export function myRelationFromVariant(
  variant: string | null | undefined,
): MyTasksRelation {
  return variant === "assigned" || variant === "created" || variant === "involved"
    ? variant
    : "all";
}
