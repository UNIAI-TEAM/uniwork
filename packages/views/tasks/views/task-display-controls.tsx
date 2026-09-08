"use client";

import { useState, type ReactNode } from "react";
import {
  Filter,
  Paperclip,
  GitBranch,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { TASK_PRIORITIES, TASK_STATUSES } from "@uniwork/core/types";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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

function CapabilityStubButton({
  icon,
  label,
  available,
  reason,
}: {
  icon: ReactNode;
  label: string;
  available: boolean;
  reason: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!available}
            aria-disabled={!available}
            aria-label={label}
            className={!available ? "opacity-60" : undefined}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      {!available ? (
        <TooltipContent side="bottom">{reason}</TooltipContent>
      ) : null}
    </Tooltip>
  );
}

export function TaskFilterMenu({
  trigger,
}: {
  trigger: React.ReactElement;
}) {
  const { t } = useTranslation();
  const statusFilters = useViewStore((s) => s.statusFilters);
  const priorityFilters = useViewStore((s) => s.priorityFilters);
  const toggleStatusFilter = useViewStore((s) => s.toggleStatusFilter);
  const togglePriorityFilter = useViewStore((s) => s.togglePriorityFilter);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("tasks.filters.status")}</DropdownMenuLabel>
          {TASK_STATUSES.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={statusFilters.includes(status)}
              onCheckedChange={() => toggleStatusFilter(status)}
            >
              {t(`tasks.status_${status}`)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("tasks.filters.priority")}</DropdownMenuLabel>
          {TASK_PRIORITIES.map((priority) => (
            <DropdownMenuCheckboxItem
              key={priority}
              checked={priorityFilters.includes(priority)}
              onCheckedChange={() => togglePriorityFilter(priority)}
            >
              {t(`tasks.priority_${priority}`)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskDisplayControls({
  modes,
  isRefreshing = false,
}: {
  modes: TaskSurfaceMode[];
  isRefreshing?: boolean;
}) {
  const { t } = useTranslation();
  const { data: publicConfig } = usePublicConfig();
  const config = publicConfig ?? EMPTY_CONFIG;
  const vcs = capabilityState(config, "tasks.vcs");
  const attachments = capabilityState(config, "tasks.attachments");
  const [displayOpen, setDisplayOpen] = useState(false);

  const showSubTasks = useViewStore((s) => s.showSubTasks);
  const toggleShowSubTasks = useViewStore((s) => s.toggleShowSubTasks);
  const cardProperties = useViewStore((s) => s.cardProperties);
  const toggleCardProperty = useViewStore((s) => s.toggleCardProperty);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <TaskFilterMenu
        trigger={
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Filter className="size-3.5" aria-hidden />
            <span className="hidden md:inline">{t("tasks.filters.add")}</span>
          </Button>
        }
      />

      <CapabilityStubButton
        icon={<GitBranch className="size-3.5" aria-hidden />}
        label={t("tasks.surface.vcs_chip_stub")}
        available={vcs.status === "available"}
        reason={t(vcs.explanation_key || "capabilities.unknown")}
      />
      <CapabilityStubButton
        icon={<Paperclip className="size-3.5" aria-hidden />}
        label={t("tasks.header.attachments_unavailable")}
        available={attachments.status === "available"}
        reason={t(attachments.explanation_key || "capabilities.unknown")}
      />

      <Popover open={displayOpen} onOpenChange={setDisplayOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              aria-label={t("tasks.display.title")}
            />
          }
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
          <span className="hidden md:inline">{t("tasks.display.title")}</span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          <div className="flex flex-col gap-2">
            <p className="text-caption font-medium text-muted-foreground">
              {t("tasks.display.list_options")}
            </p>
            <label className="flex items-center justify-between gap-2 text-body">
              <span>{t("tasks.display.show_subtasks")}</span>
              <input
                type="checkbox"
                checked={showSubTasks}
                onChange={() => toggleShowSubTasks()}
              />
            </label>
            <p className="mt-1 text-caption font-medium text-muted-foreground">
              {t("tasks.display.card_properties_section")}
            </p>
            {(
              ["priority", "assignee", "dueDate", "labels"] as const
            ).map((key) => (
              <label
                key={key}
                className="flex items-center justify-between gap-2 text-body"
              >
                <span>{t(`tasks.display.card_${key}`)}</span>
                <input
                  type="checkbox"
                  checked={cardProperties[key]}
                  onChange={() => toggleCardProperty(key)}
                />
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <TaskModeSwitcher modes={modes} />
      <ViewRefreshIndicator active={isRefreshing} />
    </div>
  );
}
