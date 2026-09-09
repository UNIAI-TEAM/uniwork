"use client";

import { TaskDetailTimeline } from "./timeline";

/** Suite timeline slot — comments and reactions. */
export function TaskDetailTimelineSlot({ taskId }: { taskId: string }) {
  return <TaskDetailTimeline taskId={taskId} />;
}
