import { z } from "zod";

export const TaskCatalogStatusSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  color: z.string(),
  is_system: z.boolean(),
  position: z.number(),
  archived_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskCatalogStatus = z.infer<typeof TaskCatalogStatusSchema>;

export const TaskLabelSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.string(),
  usage_count: z.number(),
  archived_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskLabel = z.infer<typeof TaskLabelSchema>;

export const TaskPropertySchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  config: z.record(z.string(), z.unknown()).nullable().optional().default({}),
  position: z.number(),
  usage_count: z.number(),
  archived_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskProperty = z.infer<typeof TaskPropertySchema>;
