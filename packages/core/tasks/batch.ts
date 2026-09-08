import type { Task, TaskPriority, TaskStatus } from "../types/task";

/**
 * Shared assignee across a selection. `{ kind: null, id: null }` means every
 * selected task is unassigned — distinct from a mixed selection (`null`).
 */
export interface CommonAssignee {
  kind: string | null;
  id: string | null;
}

export interface CommonTaskFields {
  status: TaskStatus | null;
  priority: TaskPriority | null;
  assignee: CommonAssignee | null;
}

function sharedValue<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0]!;
  return values.every((v) => v === first) ? first : null;
}

const ASSIGNEE_KEY_SEP = "\u0000";

function assigneeKey(kind: string | null | undefined, id: string | null | undefined): string {
  return `${kind ?? ""}${ASSIGNEE_KEY_SEP}${id ?? ""}`;
}

/** Derive the common status / priority / assignee of the selected tasks. */
export function commonTaskFields(tasks: readonly Task[]): CommonTaskFields {
  const status = sharedValue(tasks.map((t) => t.status));
  const priority = sharedValue(tasks.map((t) => t.priority));

  const sharedAssigneeKey = sharedValue(
    tasks.map((t) =>
      assigneeKey(t.assignee_kind ?? null, t.assignee_id ?? null),
    ),
  );
  const assignee =
    sharedAssigneeKey !== null && tasks.length > 0
      ? {
          kind: tasks[0]!.assignee_kind ?? null,
          id: tasks[0]!.assignee_id ?? null,
        }
      : null;

  return { status, priority, assignee };
}
