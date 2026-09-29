"use client";

import { useCallback, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePutProject } from "@uniwork/core/tasks";
import type {
  Project,
  ProjectPriority,
  ProjectStatus,
} from "@uniwork/core/types/project";
import { DateField } from "../common/date-field";
import { useWorkspaceAssigneeOptions } from "../tasks/pickers/member-options";
import {
  ProjectPriorityBadge,
  ProjectStatusBadge,
} from "./components/project-badge";
import { ProjectLeadPicker } from "./components/project-lead-picker";

function PropRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-2 flex min-h-8 items-center gap-2 rounded-md px-2 hover:bg-accent/50">
      <span className="w-20 shrink-0 text-caption text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-caption">
        {children}
      </div>
    </div>
  );
}

/**
 * Status / priority / lead / date pickers for project detail (UniWork UI only).
 */
export function ProjectProperties({
  workspaceId,
  project,
}: {
  workspaceId: string;
  project: Project;
}) {
  const { t } = useTranslation();
  const putProject = usePutProject(workspaceId);
  const { options: leadOptions } = useWorkspaceAssigneeOptions(workspaceId);
  const [open, setOpen] = useState(true);

  const save = useCallback(
    (patch: {
      status?: ProjectStatus;
      priority?: ProjectPriority;
      lead_type?: string | null;
      lead_id?: string | null;
      start_date?: string | null;
      due_date?: string | null;
    }) => {
      putProject.mutate({
        projectId: project.id,
        body: { ...patch, revision: project.revision },
        ifMatch: String(project.revision),
      });
    },
    [project.id, project.revision, putProject],
  );

  return (
    <div>
      <button
        type="button"
        className={`mb-2 flex w-full items-center gap-1 rounded-md px-2 py-1 text-caption font-medium transition-colors hover:bg-accent/70 ${
          open ? "" : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        {t("projects.detail.section_properties")}
        <ChevronRight
          aria-hidden
          className={`size-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>
      {open ? (
        <div className="space-y-0.5 pl-2">
          <PropRow label={t("projects.table.status")}>
            <ProjectStatusBadge
              project={project}
              onUpdate={(p) => save(p)}
              align="start"
            />
          </PropRow>
          <PropRow label={t("projects.table.priority")}>
            <ProjectPriorityBadge
              project={project}
              onUpdate={(p) => save(p)}
              align="start"
            />
          </PropRow>
          <PropRow label={t("projects.table.lead")}>
            <ProjectLeadPicker
              project={project}
              options={leadOptions}
              onChange={save}
              labelClassName="text-foreground"
            />
          </PropRow>
          <PropRow label={t("projects.detail.prop_start_date")}>
            <DateField
              value={project.start_date ?? ""}
              max={project.due_date ?? undefined}
              onChange={(value) =>
                save({ start_date: value === "" ? null : value })
              }
            />
          </PropRow>
          <PropRow label={t("projects.detail.prop_due_date")}>
            <DateField
              value={project.due_date ?? ""}
              min={project.start_date ?? undefined}
              onChange={(value) =>
                save({ due_date: value === "" ? null : value })
              }
            />
          </PropRow>
        </div>
      ) : null}
    </div>
  );
}
