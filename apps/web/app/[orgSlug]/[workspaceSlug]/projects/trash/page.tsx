"use client";

import { Suspense, lazy } from "react";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";

const ProjectsTrashPage = lazy(() =>
  import("@uniwork/views/projects/projects-trash-page").then((m) => ({
    default: m.ProjectsTrashPage,
  })),
);

export default function ProjectsTrashRoute() {
  const { workspace } = useWorkspace();

  return (
    <Suspense fallback={null}>
      <ProjectsTrashPage workspaceId={workspace.id} />
    </Suspense>
  );
}
