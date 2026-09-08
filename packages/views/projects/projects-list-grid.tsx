"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePutProject } from "@uniwork/core/tasks";
import type { Project } from "@uniwork/core/types/project";
import { LIST_GRID_BOTTOM_CLEARANCE } from "@uniwork/ui/components/ui/list-grid";
import { cn } from "@uniwork/ui/lib/utils";
import { PAGE_GUTTER } from "../layout/page-header";
import { ProjectIcon } from "./components/project-icon";
import { ProjectStatusBadge, ProjectPriorityBadge } from "./components/project-badge";
import { ProjectProgressRing } from "./components/project-progress";
import { ProjectRowActions } from "./components/project-row-actions";
import { formatRelativeDate, getProjectTaskMetrics } from "./project-row-metrics";

function ProjectCard({
  workspaceId,
  project,
  pinned,
  canDelete,
  onOpenProject,
  locale,
  resolveLeadName,
}: {
  workspaceId: string;
  project: Project;
  pinned: boolean;
  canDelete: boolean;
  onOpenProject: (projectId: string) => void;
  locale: string;
  resolveLeadName: (project: Project) => string | null;
}) {
  const { t } = useTranslation();
  const putProject = usePutProject(workspaceId);
  const handleUpdate = useCallback(
    (patch: { status?: string; priority?: string }) =>
      putProject.mutate({
        projectId: project.id,
        body: { ...patch, revision: project.revision },
        ifMatch: String(project.revision),
      }),
    [project.id, project.revision, putProject],
  );
  const { totalCount } = getProjectTaskMetrics(project);

  return (
    <div className="group/card group/row flex flex-col rounded-md border bg-card transition-colors hover:border-primary/50">
      <div className="p-3 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => onOpenProject(project.id)}
          >
            <ProjectIcon project={project} size="sm" />
            <h3 className="truncate text-body font-medium">{project.title}</h3>
          </button>
          <ProjectRowActions
            workspaceId={workspaceId}
            project={project}
            pinned={pinned}
            canDelete={canDelete}
            onOpenProject={onOpenProject}
          />
          <ProjectStatusBadge
            project={project}
            onUpdate={(p) => handleUpdate(p)}
            triggerClassName="shrink-0"
          />
        </div>

        {totalCount > 0 ? (
          <div className="flex items-center justify-end gap-1.5 pt-2">
            <ProjectProgressRing project={project} />
          </div>
        ) : (
          <span className="flex justify-end pt-2 text-caption text-muted-foreground">
            {t("projects.page.no_tasks_yet")}
          </span>
        )}
      </div>

      <div className="mt-0 flex items-center justify-between border-t px-3 pb-3 pt-2">
        <span className="max-w-[80px] truncate text-caption text-muted-foreground">
          {resolveLeadName(project) ?? t("projects.lead.no_lead")}
        </span>
        <div className="flex items-center gap-2">
          <ProjectPriorityBadge
            project={project}
            onUpdate={(p) => handleUpdate(p)}
            align="start"
          />
          <span className="text-caption text-muted-foreground">
            {formatRelativeDate(project.created_at, locale)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ProjectsListGrid({
  workspaceId,
  projects,
  pinnedIds,
  canDelete,
  onOpenProject,
  locale,
  resolveLeadName,
}: {
  workspaceId: string;
  projects: Project[];
  pinnedIds: Set<string>;
  canDelete: boolean;
  onOpenProject: (projectId: string) => void;
  locale: string;
  resolveLeadName: (project: Project) => string | null;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto pt-4", PAGE_GUTTER)}>
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        style={{ paddingBottom: LIST_GRID_BOTTOM_CLEARANCE }}
      >
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            workspaceId={workspaceId}
            project={project}
            pinned={pinnedIds.has(project.id)}
            canDelete={canDelete}
            onOpenProject={onOpenProject}
            locale={locale}
            resolveLeadName={resolveLeadName}
          />
        ))}
      </div>
    </div>
  );
}
