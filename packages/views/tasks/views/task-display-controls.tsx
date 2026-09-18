"use client";

import { useState } from "react";
import {
  Filter,
  Paperclip,
  GitBranch,
  MoreHorizontal,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import type { TaskSurfaceMode } from "../surface/types";
import { TaskFilterMenu } from "../filters/task-filter-menu";
import { TaskDisplaySettings } from "./task-display-settings";
import { TaskModeSwitcher } from "./task-mode-switcher";

const EMPTY_CONFIG = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: {},
} as const;

export function ViewRefreshIndicator({ active }: { active: boolean }) {
  return (
    <span className="flex w-4 shrink-0 items-center justify-center">
      {active ? (
        <span className="animate-in fade-in fill-mode-backwards [animation-delay:300ms]">
          <Spinner className="size-3.5 text-muted-foreground" />
        </span>
      ) : null}
    </span>
  );
}

export { TaskFilterMenu } from "../filters/task-filter-menu";

export function TaskDisplayControls({
  modes,
  isRefreshing = false,
  showProjectGrouping = true,
  projectGroupingDisabled = true,
  projectGroupingReasonKey,
}: {
  modes: TaskSurfaceMode[];
  isRefreshing?: boolean;
  showProjectGrouping?: boolean;
  projectGroupingDisabled?: boolean;
  projectGroupingReasonKey?: string;
}) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const vcs = capabilityState(config, "tasks.vcs");
  const attachments = capabilityState(config, "tasks.attachments");
  const [displayOpen, setDisplayOpen] = useState(false);

  const filterLabel = t("tasks.filters.add");
  const unavailableActionReason = t("tasks.surface.action_unavailable");
  const vcsReason =
    vcs.status === "available"
      ? unavailableActionReason
      : t(vcs.explanation_key || "capabilities.unknown");
  const attachmentsReason =
    attachments.status === "available"
      ? unavailableActionReason
      : t(attachments.explanation_key || "capabilities.unknown");
  return (
    <div className="flex shrink-0 items-center gap-1">
      <TaskFilterMenu
        trigger={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            className="gap-1.5"
            aria-label={filterLabel}
            data-testid="task-filter-add"
          >
            <Filter className="size-3.5" aria-hidden />
            <span className="hidden md:inline">{filterLabel}</span>
          </Button>
        }
        tooltip={filterLabel}
      />

      <Popover open={displayOpen} onOpenChange={setDisplayOpen}>
        <Tooltip>
          <PopoverTrigger
            render={
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="toolbar"
                    size="sm"
                    className="gap-1.5"
                    aria-label={t("tasks.display.title")}
                  />
                }
              />
            }
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
            <span className="hidden md:inline">{t("tasks.display.title")}</span>
          </PopoverTrigger>
          <TooltipContent side="bottom">
            {t("tasks.display.tooltip")}
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-64 p-3">
          <TaskDisplaySettings
            modes={modes}
            showProjectGrouping={showProjectGrouping}
            projectGroupingDisabled={projectGroupingDisabled}
            projectGroupingReasonKey={projectGroupingReasonKey}
            labelsDisabled
          />
        </PopoverContent>
      </Popover>

      <TaskModeSwitcher modes={modes} />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("tasks.surface.more_actions")}
            />
          }
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled title={vcsReason}>
            <GitBranch className="size-3.5" aria-hidden />
            {t("tasks.surface.vcs_chip_stub")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled title={attachmentsReason}>
            <Paperclip className="size-3.5" aria-hidden />
            {t("tasks.header.attachments_unavailable")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ViewRefreshIndicator active={isRefreshing} />
    </div>
  );
}
