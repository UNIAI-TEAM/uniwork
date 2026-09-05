import { z } from "zod";

export const AGENT_STATUSES = ["active", "paused", "archived"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AgentSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  handle: z.string(),
  description: z.string().optional().default(""),
  avatar_url: z.string().optional(),
  status: z.string(),
  owner_user_id: z.string(),
});
export type Agent = Omit<z.infer<typeof AgentSchema>, "status"> & { status: AgentStatus };
