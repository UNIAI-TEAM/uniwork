import type { TaskPriority } from "@uniwork/core/types";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";

/** One tint per priority: urgent red, high orange, medium blue, low gray. */
export const PRIORITY_TONE: Record<TaskPriority, Tint> = {
  urgent: "red",
  high: "orange",
  medium: "blue",
  low: "gray",
};

export function priorityTone(priority: string): Tint {
  return PRIORITY_TONE[priority as TaskPriority] ?? "gray";
}
