"use client";

import type { SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "@uniwork/core/types/project";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@uniwork/ui/components/ui/avatar";
import { cn } from "@uniwork/ui/lib/utils";
import { AgentBadge } from "../../agents/agent-badge";
import {
  AssigneePicker,
  type AssigneeOption,
} from "../../tasks/pickers/assignee-picker";
import {
  findProjectLeadOption,
  leadRefToProjectBody,
  projectLeadRef,
} from "../project-row-metrics";

const stopRowNavigation = (e: SyntheticEvent) => e.stopPropagation();

export function ProjectLeadAvatar({
  lead,
  className,
}: {
  lead: AssigneeOption | null;
  className?: string;
}) {
  if (!lead) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex size-[18px] shrink-0 rounded-full border border-dashed border-muted-foreground/30",
          className,
        )}
      />
    );
  }
  return (
    <Avatar aria-hidden size="sm" className={cn("size-[18px] shrink-0", className)}>
      {lead.avatarUrl ? <AvatarImage src={lead.avatarUrl} alt="" /> : null}
      <AvatarFallback className="text-micro">
        {lead.name.trim().slice(0, 1).toUpperCase() || "?"}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Inline lead picker for project rows, cards and the detail sidebar — the
 * shared assignee picker with a project's (lead_type, lead_id) pair. Members
 * and workspace agents are both offerable (the server accepts either kind).
 */
export function ProjectLeadPicker({
  project,
  options,
  onChange,
  triggerClassName,
  labelClassName,
  align = "start",
}: {
  project: Pick<Project, "lead_type" | "lead_id">;
  options: AssigneeOption[];
  onChange: (patch: { lead_type: string | null; lead_id: string | null }) => void;
  triggerClassName?: string;
  labelClassName?: string;
  align?: "start" | "center" | "end";
}) {
  const { t } = useTranslation();
  const lead = findProjectLeadOption(project, options);
  const label = lead?.name ?? t("projects.lead.no_lead");

  return (
    <AssigneePicker
      value={projectLeadRef(project)}
      options={options}
      onChange={(ref) => onChange(leadRefToProjectBody(ref))}
      ariaLabel={t("projects.table.lead")}
      valueLabel={label}
      unassignedLabel={t("projects.lead.no_lead")}
      searchPlaceholder={t("projects.lead.assign_placeholder")}
      noResultsLabel={t("projects.lead.no_results")}
      onTriggerNavigationGuard={stopRowNavigation}
      align={align}
      triggerClassName={cn(
        "h-auto min-w-0 justify-start gap-1.5 px-1 py-0.5 font-normal",
        triggerClassName,
      )}
    >
      <ProjectLeadAvatar lead={lead} />
      <span
        className={cn(
          "min-w-0 truncate text-caption text-muted-foreground",
          labelClassName,
        )}
      >
        {label}
      </span>
      {lead?.kind === "agent" ? <AgentBadge className="shrink-0" /> : null}
    </AssigneePicker>
  );
}
