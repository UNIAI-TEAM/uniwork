"use client";

import { lazy } from "react";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { TaskDetailFlagGate } from "@uniwork/views/tasks/task-detail-flag-gate";
import { TaskDetailView } from "@uniwork/views/tasks/task-detail-view";

// Suite detail is large; keep it out of the flag-off MVP entry chunk
// (scripts/bundle-budget.mjs — route ≤ 150 KB gzip).
const TaskDetailSuitePage = lazy(() =>
  import("@uniwork/views/tasks/detail").then((m) => ({
    default: m.TaskDetailSuitePage,
  })),
);

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { workspace } = useWorkspace();
  const { replace } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const onDeleted = () => replace(ws.tasks());

  return (
    <TaskDetailFlagGate
      mvp={
        <TaskDetailView
          workspaceId={workspace.id}
          taskId={taskId}
          onDeleted={onDeleted}
        />
      }
      suite={
        <TaskDetailSuitePage
          workspaceId={workspace.id}
          taskId={taskId}
          onDeleted={onDeleted}
        />
      }
    />
  );
}
