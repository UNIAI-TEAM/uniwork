"use client";
import { useParams, useRouter } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { TasksPageView } from "@uniwork/views/tasks/tasks-page-view";
import { useCurrentWorkspace } from "../layout";

export default function TasksPage() {
  const router = useRouter();
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const { workspace } = useCurrentWorkspace();
  return (
    <TasksPageView workspaceId={workspace.id} onOpenTask={(id) => router.push(paths.workspace(orgSlug, workspaceSlug).task(id))} />
  );
}
