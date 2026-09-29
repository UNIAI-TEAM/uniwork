"use client";

import { useState } from "react";
import { Filter, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TableFacetsResult } from "@uniwork/core/api/endpoints/tasks-table";
import type { TaskDateFilter } from "@uniwork/core/tasks/stores/view-store-types";
import type { TaskViewBaseline } from "@uniwork/core/tasks/views/baseline";
import type { Task } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
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
import type { TaskTableFacetSpec } from "../filters/filter-counts";
import type { TaskSurfaceMode } from "../surface/types";
import { TaskFilterMenu } from "../filters/task-filter-menu";
import { TaskDisplaySettings } from "./task-display-settings";
import { TaskModeSwitcher } from "./task-mode-switcher";

export function ViewRefreshIndicator({ active }: { active: boolean }) {
  const { t } = useTranslation();

  if (!active) return null;

  return (
    <span className="flex size-4 shrink-0 animate-in items-center justify-center fade-in fill-mode-backwards [animation-delay:300ms]">
      <Spinner
        className="size-3.5 text-muted-foreground"
        label={t("common.loading")}
      />
    </span>
  );
}

export { TaskFilterMenu } from "../filters/task-filter-menu";

export function TaskDisplayControls({
  modes,
  isRefreshing = false,
  scopedTasks,
  workspaceId,
  showProjectGrouping = true,
  projectGroupingDisabled = true,
  projectGroupingReasonKey,
  lockProjectFilter = false,
  viewBaseline,
  dateFilter,
  onDateFilterChange,
  tableFacetCounts,
  onTableFacetChange,
}: {
  modes: TaskSurfaceMode[];
  isRefreshing?: boolean;
  scopedTasks?: Task[];
  workspaceId?: string;
  showProjectGrouping?: boolean;
  projectGroupingDisabled?: boolean;
  projectGroupingReasonKey?: string;
  lockProjectFilter?: boolean;
  viewBaseline?: TaskViewBaseline;
  dateFilter?: TaskDateFilter | null;
  onDateFilterChange?: (filter: TaskDateFilter | null) => void;
  tableFacetCounts?: TableFacetsResult;
  onTableFacetChange?: (facet: TaskTableFacetSpec | null) => void;
}) {
  const { t } = useTranslation();
  const [displayOpen, setDisplayOpen] = useState(false);

  const filterLabel = t("tasks.filters.add");
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
        workspaceId={workspaceId}
        scopedTasks={scopedTasks}
        viewBaseline={viewBaseline}
        dateFilter={dateFilter}
        onDateFilterChange={onDateFilterChange}
        lockProjectFilter={lockProjectFilter}
        tableFacetCounts={tableFacetCounts}
        onTableFacetChange={onTableFacetChange}
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

      <ViewRefreshIndicator active={isRefreshing} />
    </div>
  );
}
