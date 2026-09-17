import type {
  SortDirection,
  SortField,
} from "@uniwork/core/tasks/stores/view-store";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
} from "@uniwork/core/types";

export function projectSurfaceTasks(
  tasks: Task[],
  options: {
    showSubTasks: boolean;
    sortBy: SortField;
    sortDirection: SortDirection;
  },
): Task[] {
  const visibleTasks = options.showSubTasks
    ? tasks
    : tasks.filter((task) => !task.parent_task_id);
  return sortSurfaceTasks(
    visibleTasks,
    options.sortBy,
    options.sortDirection,
  );
}

const STATUS_RANK = new Map(TASK_STATUSES.map((status, i) => [status, i]));
const PRIORITY_RANK = new Map(
  TASK_PRIORITIES.map((priority, i) => [priority, i]),
);

function sortValue(task: Task, field: SortField): string | number | null {
  switch (field) {
    case "title":
      return task.title.toLocaleLowerCase();
    case "status":
      return STATUS_RANK.get(task.status) ?? Number.MAX_SAFE_INTEGER;
    case "priority":
      return PRIORITY_RANK.get(task.priority) ?? Number.MAX_SAFE_INTEGER;
    case "due_date":
      return task.due_date ?? "";
    case "created_at":
      return task.created_at;
    case "updated_at":
      return task.updated_at;
    case "position":
      return task.position;
    case "start_date":
      return task.start_date ?? "";
    default:
      return null;
  }
}

/**
 * Client-sort loaded tasks for the views that still order on the client (list,
 * gantt, swimlane); unknown / property fields keep input order. The table sorts
 * on the server.
 */
export function sortSurfaceTasks(
  tasks: Task[],
  sortBy: SortField,
  sortDirection: SortDirection,
): Task[] {
  const ranked = tasks.map((task, index) => ({
    task,
    index,
    value: sortValue(task, sortBy),
  }));
  const direction = sortDirection === "desc" ? -1 : 1;
  ranked.sort((a, b) => {
    if (a.value == null && b.value == null) return a.index - b.index;
    if (a.value == null || a.value === "") return 1;
    if (b.value == null || b.value === "") return -1;
    if (a.value < b.value) return -1 * direction;
    if (a.value > b.value) return 1 * direction;
    return a.index - b.index;
  });
  return ranked.map((entry) => entry.task);
}
