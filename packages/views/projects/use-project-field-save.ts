"use client";

import { useCallback } from "react";
import type { PutProjectBody } from "@uniwork/core/api/endpoints/projects";
import { usePutProject } from "@uniwork/core/tasks";
import type { Project } from "@uniwork/core/types/project";

export type ProjectFieldPatch = Omit<PutProjectBody, "revision">;

/** One-field PUT guarded by the project's current revision (If-Match). */
export function useProjectFieldSave(
  workspaceId: string,
  project: Pick<Project, "id" | "revision">,
): (patch: ProjectFieldPatch) => void {
  const putProject = usePutProject(workspaceId);
  return useCallback(
    (patch: ProjectFieldPatch) => {
      putProject.mutate({
        projectId: project.id,
        body: { ...patch, revision: project.revision },
        ifMatch: String(project.revision),
      });
    },
    [project.id, project.revision, putProject],
  );
}
