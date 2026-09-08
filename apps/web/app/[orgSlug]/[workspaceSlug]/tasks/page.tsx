"use client";
import { useFlag } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { TaskSurfacePage } from "@uniwork/views/tasks/task-surface-page";
import { TasksPageView } from "@uniwork/views/tasks/tasks-page-view";

export default function TasksPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const parity = useFlag("tasks_work_management_parity", false);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const onOpenTask = (id: string) => push(ws.task(id));

  return parity ? (
    <TaskSurfacePage workspaceId={workspace.id} onOpenTask={onOpenTask} />
  ) : (
    <TasksPageView workspaceId={workspace.id} onOpenTask={onOpenTask} />
  );
}
