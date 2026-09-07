import { z } from "zod";
import { AgentSchema, type Agent } from "../../types/agent";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const AgentsResponse = z.object({ agents: z.array(AgentSchema) });

/** Agents that are members of the workspace — the ones a task can be handed to. */
export async function listWorkspaceAgents(workspaceId: string): Promise<Agent[]> {
  const raw = await request(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/agents`);
  return parseWithFallback<{ agents: Agent[] }>(raw, AgentsResponse, { agents: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/agents",
  }).agents;
}
