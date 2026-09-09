"use client";

import { Suspense, lazy } from "react";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";

// Projects list pulls suite surface; lazy keeps the route entry chunk light.
const ProjectsListPage = lazy(() =>
  import("@uniwork/views/projects/projects-list-page").then((m) => ({
    default: m.ProjectsListPage,
  })),
);

export default function ProjectsPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  return (
    <Suspense fallback={null}>
      <ProjectsListPage
        workspaceId={workspace.id}
        onOpenProject={(id) => push(ws.project(id))}
      />
    </Suspense>
  );
}
