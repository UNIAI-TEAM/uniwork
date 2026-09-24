"use client";

import { Suspense, lazy } from "react";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

// MyTasks body pulls TaskSurface; lazy keeps the route entry chunk light.
const MyTasksPageView = lazy(() =>
  import("@uniwork/views/my-tasks/my-tasks-page").then((m) => ({
    default: m.MyTasksPageView,
  })),
);

export default function MyTasksPage() {
  const { workspace, user } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

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
