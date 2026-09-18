import type { TaskPatch } from "@uniwork/core/api/endpoints/tasks";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@uniwork/core/types";
import type { ActorKind } from "@uniwork/core/types/audit";

export function taskPatchFromSurfaceUpdates(
  updates: Record<string, unknown>,
): TaskPatch {
  const patch: TaskPatch = {};
  if (typeof updates.title === "string") patch.title = updates.title;
  if (typeof updates.description === "string") {
    patch.description = updates.description;
  }
  if (
    typeof updates.status === "string" &&
    TASK_STATUSES.includes(updates.status as TaskStatus)
  ) {
    patch.status = updates.status as TaskStatus;
  }
  if (
    typeof updates.priority === "string" &&
    TASK_PRIORITIES.includes(updates.priority as TaskPriority)
  ) {
    patch.priority = updates.priority as TaskPriority;
  }
  if (typeof updates.position === "number") patch.position = updates.position;
  if (
    updates.assignee_id === null ||
    typeof updates.assignee_id === "string"
  ) {
    patch.assignee_id = updates.assignee_id;
    if (
      updates.assignee_kind === "human" ||
      updates.assignee_kind === "agent" ||
      updates.assignee_kind === "system"
    ) {
      patch.assignee_kind = updates.assignee_kind as ActorKind;
    }
  }
  if (updates.start_date === null || typeof updates.start_date === "string") {
    patch.start_date = updates.start_date;
  }
  if (updates.due_date === null || typeof updates.due_date === "string") {
    patch.due_date = updates.due_date;
  }
  if (updates.project_id === null || typeof updates.project_id === "string") {
    patch.project_id = updates.project_id;
  }
  return patch;
}
