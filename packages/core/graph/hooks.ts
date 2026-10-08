import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { getGraphHistory, getGraphNeighbors } from "../api/endpoints/graph";
import { graphKeys } from "./keys";

export { graphKeys } from "./keys";
export { useGraphUI } from "./use-graph-ui";

/** A 404 means hidden or not projected yet; retrying will not change it. */
function retryUnlessGone(count: number, err: unknown): boolean {
  return !(err instanceof ApiError && err.status === 404) && count < 2;
}

export function useGraphNeighbors(wsId: string, nodeType: string, nodeId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: graphKeys.neighbors(wsId, nodeType, nodeId),
    queryFn: () => getGraphNeighbors(wsId, nodeType, nodeId, { limit: 100 }),
    enabled: opts.enabled && !!wsId && !!nodeId,
    retry: retryUnlessGone,
  });
}

export function useGraphHistory(wsId: string, nodeType: string, nodeId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: graphKeys.history(wsId, nodeType, nodeId),
    queryFn: () => getGraphHistory(wsId, nodeType, nodeId),
    enabled: opts.enabled && !!wsId && !!nodeId,
    retry: retryUnlessGone,
  });
}
