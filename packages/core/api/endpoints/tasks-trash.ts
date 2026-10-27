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

/** Restores the task's whole trash batch. */
export async function restoreTask(taskId: string): Promise<TrashResult> {
  const raw = await request(`/api/v1/tasks/${enc(taskId)}/restore`, { method: "POST" });
  return parseTrashResult(raw, "POST /api/v1/tasks/{id}/restore");
}

export async function purgeTask(taskId: string): Promise<void> {
  await request(`/api/v1/tasks/${enc(taskId)}/purge`, { method: "POST" });
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
