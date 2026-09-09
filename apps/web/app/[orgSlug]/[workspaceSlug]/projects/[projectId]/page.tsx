"use client";

import { Suspense, lazy } from "react";
import { useParams } from "next/navigation";
import { useFlag } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { ProjectsUnavailable } from "@uniwork/views/projects/projects-unavailable";
import { useNavigation } from "@uniwork/views/navigation";

// Flag-on body pulls TaskSurface via project detail; lazy so flag-off stays light.
const ProjectDetailPage = lazy(() =>
  import("@uniwork/views/projects/project-detail-page").then((m) => ({
    default: m.ProjectDetailPage,
  })),
);

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { workspace } = useWorkspace();
  const { push, replace } = useNavigation();
  const parity = useFlag("tasks_work_management_parity", false);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  if (!parity) {
    return <ProjectsUnavailable />;
  }

  return (
    <Suspense fallback={null}>
      <ProjectDetailPage
        workspaceId={workspace.id}
        projectId={projectId}
        projectsHref={ws.projects()}
        onBack={() => replace(ws.projects())}
        onOpenTask={(id) => push(ws.task(id))}
      />
    </Suspense>
  );
}
