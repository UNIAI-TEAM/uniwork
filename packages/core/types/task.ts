import { z } from "zod";

// The closed vocabularies the UI reasons about. Used to type requests and
// UI state; response schemas below deliberately do NOT use them.
export const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TaskStatusSchema = z.enum(TASK_STATUSES);

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);

export const TASK_KINDS = ["normal", "welcome"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TaskKindSchema = z.enum(TASK_KINDS);

/**
 * Response schema. Enums are `z.string()` here on purpose: a server that
 * ships a new status must degrade to "this row lands in no column", not to a
 * failed parse and a white screen. The `Task` type below narrows them back to
 * the known unions for call sites — the runtime value can be wider, which is
 * why every switch over status/priority carries a default branch.
 */
export const TaskSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.string(),
  assignee_id: z.string().optional(),
  due_date: z.string().optional(),
  position: z.number(),
  kind: z.string().optional().default("normal"),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = Omit<z.infer<typeof TaskSchema>, "status" | "priority" | "kind"> & {
  status: TaskStatus;
  priority: TaskPriority;
  kind: TaskKind;
};

// Comments come straight off the sqlc row (snake_case); only the fields the
// UI reads are required so an extra column never breaks the parse.
export const TaskCommentSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  author_id: z.string(),
  body: z.string(),
  display_name: z.string().optional(),
});
export type TaskComment = z.infer<typeof TaskCommentSchema>;
