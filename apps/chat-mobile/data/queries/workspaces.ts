// Ported from usf apps/mobile/data/queries/workspaces.ts.
import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

/** The account's workspaces (the switcher, the layout's URL check); kept on disk by data/query-persister.ts. */
export const workspaceKeys = {
  list: () => ["workspaces"] as const,
};

export const workspaceListOptions = () =>
  queryOptions({
    queryKey: workspaceKeys.list(),
    queryFn: ({ signal }) => api.listWorkspaces({ signal }),
  });
