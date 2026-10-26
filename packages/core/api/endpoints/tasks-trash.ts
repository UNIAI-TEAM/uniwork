import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

/** What trashing or restoring a task answers: the batch and every task in it. */
const TrashResultSchema = z.object({
  trash_batch_id: z.string().default(""),
  ids: z.array(z.string()).default([]),
});
export type TrashResult = z.infer<typeof TrashResultSchema>;

const NO_RESULT: TrashResult = { trash_batch_id: "", ids: [] };

/** A successful delete still counts as one when the body drifts: no throw, an empty result. */
export function parseTrashResult(raw: unknown, endpoint: string): TrashResult {
  return parseWithFallback<TrashResult>(raw, TrashResultSchema, NO_RESULT, { endpoint });
}

const TaskTrashItemSchema = z.object({
  id: z.string(),
  identifier: z.string().optional(),
  title: z.string(),
  trashed_at: z.string(),
  trashed_by: z.string().optional(),
  purge_after: z.string(),
  batch_size: z.number().default(1),
});
export type TaskTrashItem = z.infer<typeof TaskTrashItemSchema>;

const ProjectTrashItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  trashed_at: z.string(),
  trashed_by: z.string().optional(),
  purge_after: z.string(),
  task_count: z.number().default(0),
});
export type ProjectTrashItem = z.infer<typeof ProjectTrashItemSchema>;

const TaskTrashPageSchema = z.object({
  items: z.array(TaskTrashItemSchema),
  next_cursor: z.string().default(""),
});
const ProjectTrashPageSchema = z.object({
  items: z.array(ProjectTrashItemSchema),
  next_cursor: z.string().default(""),
});
export type TaskTrashPage = z.infer<typeof TaskTrashPageSchema>;
export type ProjectTrashPage = z.infer<typeof ProjectTrashPageSchema>;

const query = (cursor?: string) => (cursor ? `?cursor=${enc(cursor)}` : "");

export async function listTaskTrash(workspaceId: string, cursor?: string): Promise<TaskTrashPage> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/tasks/trash${query(cursor)}`);
  return parseWithFallback<TaskTrashPage>(raw, TaskTrashPageSchema, { items: [], next_cursor: "" }, {
    endpoint: "GET /api/v1/workspaces/{ws}/tasks/trash",
  });
}

/** Restores the task's whole trash batch. */
export async function restoreTask(taskId: string): Promise<TrashResult> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/restore`, { method: "POST" });
  return parseTrashResult(raw, "POST /api/v1/tasks/{id}/restore");
}

export async function purgeTask(taskId: string): Promise<void> {
  await request(`/api/v1/tasks/${enc(taskId)}/purge`, { method: "POST" });
}

export async function listProjectTrash(workspaceId: string, cursor?: string): Promise<ProjectTrashPage> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/projects/trash${query(cursor)}`);
  return parseWithFallback<ProjectTrashPage>(raw, ProjectTrashPageSchema, { items: [], next_cursor: "" }, {
    endpoint: "GET /api/v1/workspaces/{ws}/projects/trash",
  });
}

/** Rejects with 409 `duplicate_project_title` when a live project took the title. */
export async function restoreProject(workspaceId: string, projectId: string): Promise<void> {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}/restore`, {
    method: "POST",
  });
}

export async function purgeProject(workspaceId: string, projectId: string): Promise<void> {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/projects/${enc(projectId)}/purge`, {
    method: "POST",
  });
}
