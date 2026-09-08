import { z } from "zod";
import { ActorSchema } from "./actor";

// The closed vocabularies the UI reasons about. Used to type requests and
// UI state; response schemas below deliberately do NOT use them.
/** Seven Work Management status categories (catalog keys). */
export const TASK_STATUS_CATEGORIES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
export type TaskStatusCategory = (typeof TASK_STATUS_CATEGORIES)[number];
/** Alias of TASK_STATUS_CATEGORIES (seven catalog keys). */
export const TASK_STATUSES = TASK_STATUS_CATEGORIES;
export type TaskStatus = TaskStatusCategory;
export const TaskStatusSchema = z.enum(TASK_STATUS_CATEGORIES);

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
 *
 * Foundation fields from UNI-495 (`organization_id`, `number`, `identifier`,
 * `revision`) are optional with defaults so MVP responses that omit them still
 * parse; suite routes always send them.
 */
export const TaskSchema = z.object({
  id: z.string(),
  organization_id: z.string().optional().default(""),
  workspace_id: z.string(),
  number: z.number().optional().default(0),
  identifier: z.string().optional().default(""),
  revision: z.number().optional().default(0),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.string(),
  assignee_id: z.string().optional(),
  // The assignee pair (ADR 0007). `assignee` is the server-resolved actor;
  // the UI reads its `kind` for the badge and never guesses from the id.
  assignee_kind: z.string().optional().default("human"),
  assignee: ActorSchema.optional(),
  due_date: z.string().optional(),
  position: z.number(),
  kind: z.string().optional().default("normal"),
  created_by: z.string(),
  created_by_kind: z.string().optional().default("human"),
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
  author_kind: z.string().optional().default("human"),
  author: ActorSchema.optional(),
  body: z.string(),
  parent_id: z.string().optional(),
  type: z.string().optional().default("comment"),
  revision: z.number().optional().default(0),
  resolved_at: z.string().optional(),
  display_name: z.string().optional(),
  avatar_url: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type TaskComment = z.infer<typeof TaskCommentSchema>;

export const TaskDependencySchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string(),
  task_id: z.string(),
  depends_on_task_id: z.string(),
  type: z.string(),
  created_at: z.string(),
});
export type TaskDependency = z.infer<typeof TaskDependencySchema>;

export const ChildProgressSchema = z.object({
  parent_task_id: z.string(),
  total: z.number(),
  done: z.number(),
});
export type ChildProgress = z.infer<typeof ChildProgressSchema>;

export const TaskQueryPageSchema = z.object({
  tasks: z.array(TaskSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type TaskQueryPage = Omit<z.infer<typeof TaskQueryPageSchema>, "tasks"> & {
  tasks: Task[];
};

export const TaskGroupSchema = z.object({
  key: z.string(),
  tasks: z.array(TaskSchema),
});
export type TaskGroup = Omit<z.infer<typeof TaskGroupSchema>, "tasks"> & { tasks: Task[] };
