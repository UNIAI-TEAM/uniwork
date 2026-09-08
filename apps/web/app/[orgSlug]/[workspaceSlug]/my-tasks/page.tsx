"use client";

import { Suspense, lazy } from "react";
import { useFlag } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { MyTasksUnavailable } from "@uniwork/views/my-tasks/my-tasks-unavailable";
import { useNavigation } from "@uniwork/views/navigation";

// Flag-on body pulls TaskSurface; lazy so flag-off stays under the route budget.
const MyTasksPageView = lazy(() =>
  import("@uniwork/views/my-tasks/my-tasks-page").then((m) => ({
    default: m.MyTasksPageView,
  })),
);

export default function MyTasksPage() {
  const { workspace, user } = useWorkspace();
  const { push } = useNavigation();
  const parity = useFlag("tasks_work_management_parity", false);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  if (!parity) {
    return <MyTasksUnavailable />;
  }

  return (
    <Suspense fallback={null}>
      <MyTasksPageView
        workspaceId={workspace.id}
        userId={user.id}
        onOpenTask={(id) => push(ws.task(id))}
      />
    </Suspense>
  );
}
