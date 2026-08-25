"use client";
import { useParams, useRouter } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { TaskDetailView } from "@uniwork/views/tasks/task-detail-view";
import { useCurrentWorkspace } from "../../layout";

export default function TaskDetailPage() {
  const router = useRouter();
  const { orgSlug, workspaceSlug, taskId } = useParams<{ orgSlug: string; workspaceSlug: string; taskId: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <TaskDetailView
      workspaceId={workspace.id}
      taskId={taskId}
      onDeleted={() => router.replace(paths.workspace(orgSlug, workspaceSlug).tasks())}
    />
  );
}
