"use client";

import { Suspense, lazy } from "react";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

// Suite detail is large; keep the route entry chunk light
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
    <Suspense fallback={null}>
      <TaskDetailSuitePage
        workspaceId={workspace.id}
        taskId={taskId}
        onDeleted={onDeleted}
      />
    </Suspense>
  );
}
