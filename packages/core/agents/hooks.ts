"use client";

import { useQuery } from "@tanstack/react-query";
import { listWorkspaceAgents } from "../api/endpoints/agents";

export const agentKeys = {
  workspace: (wsId: string) => ["agents", "workspace", wsId] as const,
};

/** Agents a task in this workspace can be assigned to. */
export function useWorkspaceAgents(workspaceId: string) {
  return useQuery({
    queryKey: agentKeys.workspace(workspaceId),
    queryFn: () => listWorkspaceAgents(workspaceId),
    enabled: !!workspaceId,
  });
}
