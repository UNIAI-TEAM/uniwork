"use client";

import { Suspense, lazy } from "react";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

// Suite TaskSurface is large; keep the route entry chunk light
// (scripts/bundle-budget.mjs — route ≤ 150 KB gzip).
const TaskSurfacePage = lazy(() =>
  import("@uniwork/views/tasks/task-surface-page").then((m) => ({
    default: m.TaskSurfacePage,
  })),
);

export default function TasksPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const onOpenTask = (id: string) => push(ws.task(id));

  return (
    <Suspense fallback={null}>
      <TaskSurfacePage workspaceId={workspace.id} onOpenTask={onOpenTask} />
    </Suspense>
  );
}
