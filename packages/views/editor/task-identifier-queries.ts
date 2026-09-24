export function taskIdentifierOptions(_wsId: string, identifier: string) {
  return {
    queryKey: ["task-identifier", identifier] as const,
    queryFn: async () => null as { id: string; identifier: string } | null,
    enabled: Boolean(identifier),
  };
}

/** Stub workspace list for identifier prefix checks until detail suite wires search. */
export function workspaceListOptions(_wsId = "") {
  return {
    queryKey: ["workspace-list-stub", _wsId] as const,
    queryFn: async () =>
      [] as Array<{ id: string; slug: string; issue_prefix?: string }>,
  };
}

export const workspaceKeys = {
  members: (wsId: string) => ["members", wsId] as const,
  agents: (wsId: string) => ["agents", "workspace", wsId] as const,
  squads: (wsId: string) => ["squads", wsId] as const,
};

export function flattenTaskBuckets(_cache: unknown): unknown[] {
  return [];
}

/** Editor-local list key factory — distinct from `@uniwork/core` `taskKeys`. */
export const editorTaskKeys = {
  list: (wsId: string) => ["tasks", "list", wsId] as const,
};

export const PAGINATED_CATEGORIES: string[] = [];
