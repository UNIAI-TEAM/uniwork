"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProject } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import { PAGE_GUTTER, PAGE_LEADING_ICON } from "../layout/page-header";
import { TaskSurface } from "../tasks/surface/task-surface";
import { ProjectDetailHeader } from "./project-detail-header";
import { ProjectProperties } from "./project-properties";
import { ProjectResourcesSection } from "./project-resources-section";

const PROJECT_SURFACE_MODES = [
  "board",
  "list",
  "table",
  "gantt",
  "swimlane",
] as const;

/**
 * Project detail chrome: editable title/description + properties, resources
 * section, and a project-scoped TaskSurface (server filters by project_id).
 */
export function ProjectDetailPage({
  workspaceId,
  projectId,
  onOpenTask,
  onBack,
  projectsHref,
}: {
  workspaceId: string;
  projectId: string;
  onOpenTask?: (id: string) => void;
  onBack: () => void;
  /** Optional list href for the breadcrumb crumb; Task 8 wires paths. */
  projectsHref?: string;
}) {
  const { t } = useTranslation();
  const { data: project, isLoading } = useProject(workspaceId, projectId);

  const backLeading = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={PAGE_LEADING_ICON}
      onClick={onBack}
      aria-label={t("common.back")}
    >
      <ArrowLeft className="size-4" aria-hidden />
    </Button>
  );

  if (isLoading || !project) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <BreadcrumbHeader
          leading={backLeading}
          segments={
            projectsHref
              ? [
                  {
                    href: projectsHref,
                    label: t("projects.detail.breadcrumb_fallback"),
                  },
                ]
              : []
          }
          leaf={
            isLoading ? t("common.loading") : t("projects.detail.not_found")
          }
        />
        {isLoading ? (
          <div className={`space-y-3 py-6 ${PAGE_GUTTER}`}>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BreadcrumbHeader
        leading={backLeading}
        segments={
          projectsHref
            ? [
                {
                  href: projectsHref,
                  label: t("projects.detail.breadcrumb_fallback"),
                },
              ]
            : []
        }
        leaf={
          <span className="truncate font-medium text-foreground">
            {project.title}
          </span>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <TaskSurface
            workspaceId={workspaceId}
            scope={{ type: "project", projectId }}
            modes={[...PROJECT_SURFACE_MODES]}
            surfaceKey={`project:${projectId}`}
            onOpenTask={onOpenTask}
          />
        </div>

        <aside
          className={`shrink-0 overflow-y-auto border-t border-border py-4 lg:w-80 lg:border-l lg:border-t-0 ${PAGE_GUTTER}`}
        >
          <div className="space-y-5">
            <ProjectDetailHeader workspaceId={workspaceId} project={project} />
            <ProjectProperties workspaceId={workspaceId} project={project} />
            <ProjectResourcesSection
              workspaceId={workspaceId}
              projectId={projectId}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
