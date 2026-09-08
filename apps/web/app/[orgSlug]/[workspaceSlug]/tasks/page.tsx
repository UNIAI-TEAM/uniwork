"use client";

import { Suspense, lazy } from "react";
import { useFlag } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { TasksPageView } from "@uniwork/views/tasks/tasks-page-view";

// Suite TaskSurface is large; keep it out of the flag-off MVP entry chunk
// (scripts/bundle-budget.mjs — route ≤ 150 KB gzip).
const TaskSurfacePage = lazy(() =>
  import("@uniwork/views/tasks/task-surface-page").then((m) => ({
    default: m.TaskSurfacePage,
  })),
);

export default function TasksPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const parity = useFlag("tasks_work_management_parity", false);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const onOpenTask = (id: string) => push(ws.task(id));

  if (!parity) {
    return <TasksPageView workspaceId={workspace.id} onOpenTask={onOpenTask} />;
  }

  return (
    <Suspense fallback={null}>
      <TaskSurfacePage workspaceId={workspace.id} onOpenTask={onOpenTask} />
    </Suspense>
  );
}
