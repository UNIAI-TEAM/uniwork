"use client";

import { AgentRunPanel } from "./agent-run-panel";
import { TaskPullRequestList } from "./pull-request-list";

/**
 * AgentRun + linked-PR chrome for task detail. Composes richer stub panels;
 * capabilities stay unavailable — no runtime mutation.
 */
export function TaskDetailRuntimeStubs({ taskId }: { taskId?: string }) {
  return (
    <div className="space-y-4" data-testid="task-detail-runtime-stubs">
      <AgentRunPanel taskId={taskId} />
      <TaskPullRequestList taskId={taskId} />
    </div>
  );
}
