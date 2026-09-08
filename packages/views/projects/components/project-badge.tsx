"use client";

import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PROJECT_PRIORITY_CONFIG,
  PROJECT_PRIORITY_ORDER,
  PROJECT_STATUS_CONFIG,
  PROJECT_STATUS_ORDER,
} from "@uniwork/core/projects/config";
import type {
  Project,
  ProjectPriority,
  ProjectStatus,
} from "@uniwork/core/types/project";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";

function asStatus(value: string): ProjectStatus {
  return (PROJECT_STATUS_ORDER as string[]).includes(value)
    ? (value as ProjectStatus)
    : "planned";
}

function asPriority(value: string): ProjectPriority {
  return (PROJECT_PRIORITY_ORDER as string[]).includes(value)
    ? (value as ProjectPriority)
    : "none";
}

export function ProjectStatusBadge({
  project,
  onUpdate,
  triggerClassName,
  align = "end",
}: {
  project: Project;
  onUpdate: (patch: { status: ProjectStatus }) => void;
  triggerClassName?: string;
  align?: "start" | "end" | "center";
}) {
  const { t } = useTranslation();
  const status = asStatus(project.status);
  const cfg = PROJECT_STATUS_CONFIG[status];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-caption font-medium transition-opacity hover:opacity-80",
              cfg.badgeBg,
              cfg.badgeText,
              triggerClassName,
            )}
          />
        }
      >
        {t(`projects.status.${status}`)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        {PROJECT_STATUS_ORDER.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onUpdate({ status: s })}>
            <span className={cn("size-2 rounded-full", PROJECT_STATUS_CONFIG[s].dotColor)} />
            <span>{t(`projects.status.${s}`)}</span>
            {s === status ? <Check className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectPriorityBadge({
  project,
  onUpdate,
  triggerClassName,
  align = "end",
}: {
  project: Project;
  onUpdate: (patch: { priority: ProjectPriority }) => void;
  triggerClassName?: string;
  align?: "start" | "end" | "center";
}) {
  const { t } = useTranslation();
  const priority = asPriority(project.priority);
  const cfg = PROJECT_PRIORITY_CONFIG[priority];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-caption font-medium transition-colors hover:bg-accent/60",
              triggerClassName,
            )}
          />
        }
      >
        <span className={cn("text-caption", cfg.color)}>
          {t(`projects.priority.${priority}`)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        {PROJECT_PRIORITY_ORDER.map((p) => (
          <DropdownMenuItem key={p} onClick={() => onUpdate({ priority: p })}>
            <span className={cn("text-caption", PROJECT_PRIORITY_CONFIG[p].color)}>
              {t(`projects.priority.${p}`)}
            </span>
            {p === priority ? <Check className="ml-auto size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
