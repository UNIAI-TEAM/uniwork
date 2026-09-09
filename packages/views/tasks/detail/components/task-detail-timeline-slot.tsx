"use client";

import { TaskDetailTimeline } from "./timeline";

/** Suite timeline slot — comments, reactions, AgentRun/PR stubs. */
export function TaskDetailTimelineSlot({ taskId }: { taskId: string }) {
  return <TaskDetailTimeline taskId={taskId} />;
}
