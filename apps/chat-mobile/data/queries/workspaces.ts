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
    // Asked once whatever onlineManager says: the picker is the first screen after sign-in, and NetInfo's probe can
    // be wrong (TestFlight build 4 probed a route production did not serve, and every query waited for an online
    // that never came). A real network failure is then an error with Retry; only a retry waits for the network.
    networkMode: "offlineFirst",
  });
