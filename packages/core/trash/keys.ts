/** Query keys of the shared trash; every key carries the workspace id. */
export const trashKeys = {
  all: ["trash"] as const,
  workspace: (wsId: string) => [...trashKeys.all, wsId] as const,
  list: (wsId: string, filterKey: string) => [...trashKeys.workspace(wsId), "list", filterKey] as const,
};
