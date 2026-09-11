import type {
  SortDirection,
  SortField,
} from "@uniwork/core/tasks/stores/view-store";
import type { Task } from "@uniwork/core/types";
import { sortTasksForTable } from "../modes/table-view-model";

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
  return sortTasksForTable(
    visibleTasks,
    options.sortBy,
    options.sortDirection,
  );
}
