"use client";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { TasksPageView } from "@uniwork/views/tasks/tasks-page-view";

export default function TasksPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return <TasksPageView workspaceId={workspace.id} onOpenTask={(id) => push(ws.task(id))} />;
}
