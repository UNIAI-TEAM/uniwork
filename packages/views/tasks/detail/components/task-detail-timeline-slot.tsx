"use client";

import { TaskDetailTimeline } from "./timeline";

/** Suite timeline slot — comments, activity from the audit log, reactions. */
export function TaskDetailTimelineSlot({
  workspaceId,
  taskId,
}: {
  workspaceId: string;
  taskId: string;
}) {
  return <TaskDetailTimeline workspaceId={workspaceId} taskId={taskId} />;
}
