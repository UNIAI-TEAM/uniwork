"use client";
import { useParams, useRouter } from "next/navigation";
import { TaskDetailView } from "@uniwork/views/tasks/task-detail-view";
import { useCurrentWorkspace } from "../../layout";

export default function TaskDetailPage() {
  const router = useRouter();
  const { workspaceSlug, taskId } = useParams<{ workspaceSlug: string; taskId: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <TaskDetailView
      workspaceId={workspace.id}
      taskId={taskId}
      onDeleted={() => router.replace(`/${workspaceSlug}/tasks`)}
    />
  );
}
