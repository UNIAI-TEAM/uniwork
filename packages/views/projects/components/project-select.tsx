"use client";

import { useMemo } from "react";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { useProjects } from "@uniwork/core/tasks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";

const NO_PROJECT = "__no_project__";
const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

/** Whether the workspace surface offers projects (the tasks.projects capability). */
export function useProjectsAvailable(): boolean {
  const { data } = usePublicConfig();
  return capabilityState(data ?? EMPTY_CONFIG, "tasks.projects").status === "available";
}

/**
 * A form-shaped project picker: "no project" first, then the workspace's
 * projects. `undefined` means no project. Used by Email Hub's create-tasks
 * dialog and the meeting forms (C-11 §9.1 V2).
 */
export function ProjectSelect({
  workspaceId,
  value,
  onChange,
  noneLabel,
  ariaLabel,
  id,
  size = "default",
  className,
}: {
  workspaceId: string;
  value?: string;
  onChange: (projectId: string | undefined) => void;
  noneLabel: string;
  ariaLabel: string;
  id?: string;
  size?: "sm" | "default";
  className?: string;
}) {
  const { data } = useProjects(workspaceId);
  const projects = useMemo(() => data?.projects ?? [], [data?.projects]);
  const items = useMemo(
    () => [{ value: NO_PROJECT, label: noneLabel }, ...projects.map((p) => ({ value: p.id, label: p.title }))],
    [noneLabel, projects],
  );
  const selectValue = value?.trim() ? value : NO_PROJECT;
  const active = items.find((item) => item.value === selectValue);

  return (
    <Select
      items={items}
      value={selectValue}
      onValueChange={(next) => onChange(!next || next === NO_PROJECT ? undefined : next)}
    >
      <SelectTrigger id={id} size={size} className={className} aria-label={ariaLabel}>
        {/* A value missing from the list (a deleted project) reads as no project, not as its raw id. */}
        <SelectValue placeholder={noneLabel}>{active?.label ?? noneLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
