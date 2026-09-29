"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { useProjects } from "@uniwork/core/tasks";
import type { Task } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { PROP_ROW_TRIGGER_CLASS, PropRow } from "../../../common/prop-row";
import { ProjectIcon } from "../../../projects/components/project-icon";
import { PickerEmpty, PickerItem, PropertyPicker } from "../../pickers/property-picker";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

/** Project row: searchable picker that shows each project's own icon. */
export function TaskProjectRow({
  workspaceId,
  task,
  onChange,
}: {
  workspaceId: string;
  task: Task;
  onChange: (projectId: string | null) => void;
}) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const projectsQuery = useProjects(workspaceId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const capability = capabilityState(publicConfig ?? EMPTY_CONFIG, "tasks.projects");
  const disabled = capability.status !== "available";
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data]);
  const current = projects.find((project) => project.id === task.project_id);
  const shown = current?.title ?? t("tasks.detail.prop_project_none");
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return projects;
    return projects.filter((project) => project.title.toLocaleLowerCase().includes(q));
  }, [projects, query]);

  const select = (projectId: string | null) => {
    setOpen(false);
    if (projectId !== (task.project_id ?? null)) onChange(projectId);
  };

  return (
    <PropRow label={t("tasks.detail.prop_project")}>
      <PropertyPicker
        open={disabled ? false : open}
        onOpenChange={(next) => {
          if (!disabled) setOpen(next);
        }}
        width="w-60"
        align="start"
        searchable
        searchPlaceholder={t("tasks.create.project_search_placeholder")}
        onSearchChange={setQuery}
        triggerRender={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={PROP_ROW_TRIGGER_CLASS}
            aria-label={`${t("tasks.detail.prop_project")}: ${shown}`}
            aria-disabled={disabled || undefined}
            title={
              disabled
                ? t(capability.explanation_key || "capabilities.surface_not_ready")
                : undefined
            }
          />
        }
        trigger={
          <>
            <ProjectIcon project={current} />
            <span className={current ? "truncate" : "truncate text-muted-foreground"}>
              {shown}
            </span>
          </>
        }
      >
        <PickerItem emptyValue selected={!task.project_id} onClick={() => select(null)}>
          <ProjectIcon />
          <span className="text-muted-foreground">{t("tasks.detail.prop_project_none")}</span>
        </PickerItem>
        {filtered.map((project) => (
          <PickerItem
            key={project.id}
            selected={project.id === task.project_id}
            onClick={() => select(project.id)}
          >
            <ProjectIcon project={project} />
            <span className="truncate">{project.title}</span>
          </PickerItem>
        ))}
        {projects.length > 0 && filtered.length === 0 ? (
          <PickerEmpty>{t("tasks.create.options_no_results")}</PickerEmpty>
        ) : null}
      </PropertyPicker>
    </PropRow>
  );
}
