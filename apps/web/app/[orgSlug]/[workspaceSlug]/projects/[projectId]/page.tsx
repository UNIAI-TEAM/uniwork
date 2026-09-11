"use client";

import { Suspense, lazy } from "react";
import { useParams } from "next/navigation";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

// Project detail pulls TaskSurface; lazy keeps the route entry chunk light.
const ProjectDetailPage = lazy(() =>
  import("@uniwork/views/projects/project-detail-page").then((m) => ({
    default: m.ProjectDetailPage,
  })),
);

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { workspace } = useWorkspace();
  const { push, replace } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

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
