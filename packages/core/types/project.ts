import { z } from "zod";

export type ProjectStatus =
  | "planned"
  | "in_progress"
  | "paused"
  | "completed"
  | "cancelled";

export type ProjectPriority = "urgent" | "high" | "medium" | "low" | "none";

export const ProjectSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string().nullable().optional(),
  status: z.string(),
  priority: z.string(),
  lead_type: z.string().nullable().optional(),
  lead_id: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  revision: z.number(),
  task_count: z.number(),
  done_count: z.number(),
  resource_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectResourceSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  workspace_id: z.string(),
  resource_type: z.string(),
  resource_ref: z.unknown(),
  label: z.string().nullable().optional(),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ProjectResource = z.infer<typeof ProjectResourceSchema>;
