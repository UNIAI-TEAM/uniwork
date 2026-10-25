import { errorCode, errorFields } from "@uniwork/core/api/http";

/**
 * The one item an active_duplicate_task refusal can be linked from, and the
 * open task to link it to (follow-5): only when the refusal names a single
 * item and the open task it clashed with. With several items the server
 * names the task of the first one only, so no item is guessed.
 */
export function duplicateLinkTarget(err: unknown): { itemId: string; taskId: string } | null {
  if (errorCode(err) !== "active_duplicate_task") return null;
  const fields = errorFields(err) ?? {};
  const ids = Array.isArray(fields.action_item_ids) ? fields.action_item_ids : [];
  const [itemId] = ids;
  const taskId = fields.task_id;
  if (ids.length !== 1 || typeof itemId !== "string" || typeof taskId !== "string" || !taskId) return null;
  return { itemId, taskId };
}
