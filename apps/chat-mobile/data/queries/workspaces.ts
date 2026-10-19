// Ported from usf apps/mobile/data/queries/workspaces.ts.
import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const workspaceListOptions = () =>
  queryOptions({
    queryKey: ["workspaces"] as const,
    queryFn: ({ signal }) => api.listWorkspaces({ signal }),
  });
