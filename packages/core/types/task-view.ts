import { z } from "zod";

const JsonValue = z.unknown();

export const TaskViewSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string(),
  owner_id: z.string(),
  name: z.string(),
  scope_type: z.string(),
  scope_id: z.string().nullable().optional(),
  scope_variant: z.string().nullable().optional(),
  visibility: z.string(),
  definition_version: z.number(),
  query: JsonValue,
  display: JsonValue,
  revision: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskView = z.infer<typeof TaskViewSchema>;

export const TaskViewPreferenceSchema = z.object({
  scope_type: z.string(),
  scope_id: z.string(),
  prefs: JsonValue,
  updated_at: z.string().optional().default(""),
});
export type TaskViewPreference = z.infer<typeof TaskViewPreferenceSchema>;

export const TaskPinSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string(),
  user_id: z.string(),
  item_type: z.string(),
  item_id: z.string(),
  position: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskPin = z.infer<typeof TaskPinSchema>;
