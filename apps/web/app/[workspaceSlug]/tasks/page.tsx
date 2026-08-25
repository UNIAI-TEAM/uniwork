"use client";
import { useParams, useRouter } from "next/navigation";
import { TasksPageView } from "@uniwork/views/tasks/tasks-page-view";
import { useCurrentWorkspace } from "../layout";

export default function TasksPage() {
  const router = useRouter();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <TasksPageView
      workspaceId={workspace.id}
      onOpenTask={(id) => router.push(`/${workspaceSlug}/tasks/${id}`)}
    />
  );
}
