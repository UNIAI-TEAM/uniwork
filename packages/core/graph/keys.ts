/** Work Graph query keys. The workspace sits at the root so one invalidation covers it. */
export const graphKeys = {
  all: ["graph"] as const,
  workspace: (wsId: string) => [...graphKeys.all, wsId] as const,
  node: (wsId: string, nodeType: string, nodeId: string) => [...graphKeys.workspace(wsId), nodeType, nodeId] as const,
  neighbors: (wsId: string, nodeType: string, nodeId: string) => [...graphKeys.node(wsId, nodeType, nodeId), "neighbors"] as const,
  history: (wsId: string, nodeType: string, nodeId: string) => [...graphKeys.node(wsId, nodeType, nodeId), "history"] as const,
};
