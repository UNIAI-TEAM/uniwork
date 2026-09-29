"use client";

import type { ReactNode } from "react";
import { CalendarClock, CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Project } from "@uniwork/core/types/project";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField, toDateOnly } from "../common/date-field";
import { useWorkspaceAssigneeOptions } from "../tasks/pickers/member-options";
import {
  ProjectPriorityBadge,
  ProjectStatusBadge,
} from "./components/project-badge";
import { ProjectLeadPicker } from "./components/project-lead-picker";
import { ProjectSidebarSection } from "./components/project-sidebar-section";
import { getProjectTaskMetrics } from "./project-row-metrics";
import { useProjectFieldSave } from "./use-project-field-save";

function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="-mx-2 flex min-h-8 items-center gap-2 rounded-md px-2 transition-colors hover:bg-accent/50">
      <span className="w-20 shrink-0 text-caption text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-caption">
        {children}
      </div>
    </div>
  );
}

/** Short "29 thg 9" in the current year; the year appears only when it differs. */
function dateFormatFor(value: string | null): Intl.DateTimeFormatOptions {
  const sameYear = value?.slice(0, 4) === String(new Date().getFullYear());
  return sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
}

function ProjectDatePill({
  value,
  label,
  icon,
  min,
  max,
  highlightOverdue = false,
  onChange,
}: {
  value: string | null;
  label: string;
  icon: ReactNode;
  min?: string;
  max?: string;
  highlightOverdue?: boolean;
  onChange: (value: string | null) => void;
}) {
  const overdue = highlightOverdue && !!value && value < toDateOnly(new Date());
  return (
    <DateField
      value={value ?? ""}
      min={min}
      max={max}
      placeholder={label}
      formatOptions={dateFormatFor(value)}
      triggerRender={
        <button
          type="button"
          className="-mx-1 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-caption transition-colors hover:bg-accent/30"
        />
      }
      renderTrigger={(text, selected) => (
        <>
          {icon}
          <span
            className={cn(
              "truncate",
              !selected && "text-muted-foreground",
              overdue && "text-destructive",
            )}
          >
            {text}
          </span>
        </>
      )}
      onChange={(next) => onChange(next === "" ? null : next)}
    />
  );
}

/** Status / priority / lead / date pickers for project detail. */
export function ProjectProperties({
  workspaceId,
  project,
}: {
  workspaceId: string;
  project: Project;
}) {
  const { t } = useTranslation();
  const save = useProjectFieldSave(workspaceId, project);
  const { options: leadOptions } = useWorkspaceAssigneeOptions(workspaceId);

  return (
    <ProjectSidebarSection title={t("projects.detail.section_properties")}>
      <div className="space-y-0.5 pl-2">
        <PropRow label={t("projects.table.status")}>
          <ProjectStatusBadge
            project={project}
            onUpdate={save}
            align="start"
            appearance="plain"
          />
        </PropRow>
        <PropRow label={t("projects.table.priority")}>
          <ProjectPriorityBadge project={project} onUpdate={save} align="start" />
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
          <ProjectDatePill
            value={project.start_date ?? null}
            label={t("projects.detail.prop_start_date")}
            icon={<CalendarClock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
            max={project.due_date ?? undefined}
            onChange={(start_date) => save({ start_date })}
          />
        </PropRow>
        <PropRow label={t("projects.detail.prop_due_date")}>
          <ProjectDatePill
            value={project.due_date ?? null}
            label={t("projects.detail.prop_due_date")}
            icon={<CalendarDays aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
            min={project.start_date ?? undefined}
            highlightOverdue={project.status !== "completed" && project.status !== "cancelled"}
            onChange={(due_date) => save({ due_date })}
          />
        </PropRow>
      </div>
    </ProjectSidebarSection>
  );
}

/** Done / total tasks bar; hidden while the project has no tasks. */
export function ProjectProgressSection({ project }: { project: Project }) {
  const { t } = useTranslation();
  const { totalCount, completedCount } = getProjectTaskMetrics(project);
  if (totalCount <= 0) return null;
  const percent = Math.round((completedCount / totalCount) * 100);
  const label = t("projects.detail.section_progress");

  return (
    <ProjectSidebarSection title={label}>
      <div className="flex items-center gap-3 pl-2">
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-success-solid transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
          {`${completedCount}/${totalCount}`}
        </span>
      </div>
    </ProjectSidebarSection>
  );
}
