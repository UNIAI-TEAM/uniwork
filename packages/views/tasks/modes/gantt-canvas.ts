import type { Task, TaskStatus } from "@uniwork/core/types";

const COMPLETED: ReadonlySet<TaskStatus> = new Set(["done", "cancelled"]);

/**
 * Rows the gantt canvas draws: must have a date, and completed work is hidden
 * unless the user asks for it. Lives outside GanttView so the surface / header
 * can share the same projection.
 */
export function ganttCanvasRows(
  tasks: Task[],
  showCompleted: boolean,
): Task[] {
  const dated = tasks.filter((task) => task.start_date || task.due_date);
  if (showCompleted) return dated;
  return dated.filter((task) => !COMPLETED.has(task.status));
}
