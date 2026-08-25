"use client";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { TaskDetailView } from "@uniwork/views/tasks/task-detail-view";

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { workspace } = useWorkspace();
  const { replace } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  return <TaskDetailView workspaceId={workspace.id} taskId={taskId} onDeleted={() => replace(ws.tasks())} />;
}
