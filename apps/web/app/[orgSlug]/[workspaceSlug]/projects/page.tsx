"use client";

import { Suspense, lazy } from "react";
import { useFlag } from "@uniwork/core/feature-flags";
import { paths } from "@uniwork/core/paths";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { ProjectsUnavailable } from "@uniwork/views/projects/projects-unavailable";
import { useNavigation } from "@uniwork/views/navigation";

// Flag-on body pulls the projects list; lazy so flag-off stays under the route budget.
const ProjectsListPage = lazy(() =>
  import("@uniwork/views/projects/projects-list-page").then((m) => ({
    default: m.ProjectsListPage,
  })),
);

export default function ProjectsPage() {
  const { workspace } = useWorkspace();
  const { push } = useNavigation();
  const parity = useFlag("tasks_work_management_parity", false);
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);

  if (!parity) {
    return <ProjectsUnavailable />;
  }

  return (
    <Suspense fallback={null}>
      <ProjectsListPage
        workspaceId={workspace.id}
        onOpenProject={(id) => push(ws.project(id))}
      />
    </Suspense>
  );
}
