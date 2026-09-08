"use client";

import { useFlag } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import {
  MyTasksPageView,
  MyTasksUnavailable,
} from "@uniwork/views/my-tasks/my-tasks-page";
import { useNavigation } from "@uniwork/views/navigation";

export default function MyTasksPage() {
  const { workspace, user } = useWorkspace();
  const { push } = useNavigation();
  const parity = useFlag("tasks_work_management_parity", false);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  if (!parity) {
    return <MyTasksUnavailable />;
  }

  return (
    <MyTasksPageView
      workspaceId={workspace.id}
      userId={user.id}
      onOpenTask={(id) => push(ws.task(id))}
    />
  );
}
