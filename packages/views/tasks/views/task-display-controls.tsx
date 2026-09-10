"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Filter,
  Paperclip,
  GitBranch,
  MoreHorizontal,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import {
  CARD_PROPERTY_OPTIONS,
  GROUPING_OPTIONS,
  SORT_OPTIONS,
  SWIMLANE_GROUPINGS,
  type SortField,
  type SwimlaneGrouping,
  type TaskGrouping,
} from "@uniwork/core/tasks/stores/view-store";
import { TASK_PRIORITIES, TASK_STATUSES } from "@uniwork/core/types";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
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

/**
 * Status/priority menu UI. Kept for when `tasks/utils/filter.ts` lands and
 * surface queries honor the store; until then {@link TaskDisplayControls}
 * shows a disabled stub so the chrome does not pretend to filter.
 */
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

/** Until client filter wiring exists, Add filter must not mutate visible rows. */
const TASK_FILTERS_WIRED = false;
const FILTERS_UNAVAILABLE_REASON_CODE = "filters_not_wired";

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

  const showSubTasks = useViewStore((s) => s.showSubTasks);
  const toggleShowSubTasks = useViewStore((s) => s.toggleShowSubTasks);
  const cardProperties = useViewStore((s) => s.cardProperties);
  const toggleCardProperty = useViewStore((s) => s.toggleCardProperty);
  const viewMode = useViewStore((s) => s.viewMode);
  const grouping = useViewStore((s) => s.grouping);
  const setGrouping = useViewStore((s) => s.setGrouping);
  const swimlaneGrouping = useViewStore((s) => s.swimlaneGrouping);
  const setSwimlaneGrouping = useViewStore((s) => s.setSwimlaneGrouping);
  const sortBy = useViewStore((s) => s.sortBy);
  const setSortBy = useViewStore((s) => s.setSortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);
  const setSortDirection = useViewStore((s) => s.setSortDirection);

  const filterLabel = t("tasks.filters.add");
  const filterUnavailableReason = t("tasks.filters.unavailable");
  const unavailableActionReason = t("tasks.surface.action_unavailable");
  const groupingReason = projectGroupingReasonKey
    ? t(projectGroupingReasonKey)
    : t("tasks.surface.grouping_unavailable");
  const vcsReason =
    vcs.status === "available"
      ? unavailableActionReason
      : t(vcs.explanation_key || "capabilities.unknown");
  const attachmentsReason =
    attachments.status === "available"
      ? unavailableActionReason
      : t(attachments.explanation_key || "capabilities.unknown");
  const groupingOptions = GROUPING_OPTIONS.filter(
    (option) => option.value !== "project" || showProjectGrouping,
  );
  const effectiveGrouping = groupingOptions.some(
    (option) => option.value === grouping,
  )
    ? grouping
    : "status";
  const effectiveSortBy = SORT_OPTIONS.some((option) => option.value === sortBy)
    ? sortBy
    : "position";

  return (
    <div className="flex shrink-0 items-center gap-1">
      {TASK_FILTERS_WIRED ? (
        <TaskFilterMenu
          trigger={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              data-testid="task-filter-add"
            >
              <Filter className="size-3.5" aria-hidden />
              <span className="hidden md:inline">{filterLabel}</span>
            </Button>
          }
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                aria-disabled
                aria-label={filterLabel}
                className="gap-1.5 opacity-60"
                data-testid="task-filter-add"
                data-reason-code={FILTERS_UNAVAILABLE_REASON_CODE}
              />
            }
          >
            <Filter className="size-3.5" aria-hidden />
            <span className="hidden md:inline">{filterLabel}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{filterUnavailableReason}</TooltipContent>
        </Tooltip>
      )}

      <Popover open={displayOpen} onOpenChange={setDisplayOpen}>
        <Tooltip>
          <PopoverTrigger
            render={
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
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
          <div className="space-y-3">
            {viewMode === "board" ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption font-medium text-muted-foreground">
                  {t("tasks.display.grouping_section")}
                </span>
                <Select
                  items={groupingOptions.map((option) => ({
                    value: option.value,
                    label: t(`tasks.display.group_${option.value}`),
                  }))}
                  value={effectiveGrouping}
                  onValueChange={(value) => {
                    if (value) setGrouping(value as TaskGrouping);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-32"
                    aria-label={t("tasks.display.grouping_section")}
                  >
                    <SelectValue>
                      {t(`tasks.display.group_${effectiveGrouping}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      {groupingOptions.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          disabled={
                            option.value === "project" &&
                            projectGroupingDisabled
                          }
                          title={
                            option.value === "project" &&
                            projectGroupingDisabled
                              ? groupingReason
                              : undefined
                          }
                        >
                          {t(`tasks.display.group_${option.value}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {viewMode === "swimlane" ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-caption font-medium text-muted-foreground">
                  {t("tasks.display.grouping_section")}
                </span>
                <Select
                  items={SWIMLANE_GROUPINGS.map((value) => ({
                    value,
                    label: t(`tasks.display.group_${value}`),
                  }))}
                  value={swimlaneGrouping}
                  onValueChange={(value) => {
                    if (value) {
                      setSwimlaneGrouping(value as SwimlaneGrouping);
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-32"
                    aria-label={t("tasks.display.grouping_section")}
                  >
                    <SelectValue>
                      {t(`tasks.display.group_${swimlaneGrouping}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      {SWIMLANE_GROUPINGS.map((value) => (
                        <SelectItem
                          key={value}
                          value={value}
                          disabled={
                            value === "parent" ||
                            (value === "project" && projectGroupingDisabled)
                          }
                          title={
                            value === "parent"
                              ? t("tasks.swimlane.parent_unavailable")
                              : value === "project" && projectGroupingDisabled
                                ? groupingReason
                                : undefined
                          }
                        >
                          {t(`tasks.display.group_${value}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <span className="text-caption font-medium text-muted-foreground">
                {t("tasks.display.ordering_section")}
              </span>
              <div className="flex items-center gap-1.5">
                <Select
                  items={SORT_OPTIONS.map((option) => ({
                    value: option.value,
                    label: t(`tasks.display.sort_${option.value}`),
                  }))}
                  value={effectiveSortBy}
                  onValueChange={(value) => {
                    if (value) setSortBy(value as SortField);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-28"
                    aria-label={t("tasks.display.ordering_section")}
                  >
                    <SelectValue>
                      {t(`tasks.display.sort_${effectiveSortBy}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectGroup>
                      {SORT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(`tasks.display.sort_${option.value}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {effectiveSortBy !== "position" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={
                      sortDirection === "asc"
                        ? t("tasks.display.ascending_title")
                        : t("tasks.display.descending_title")
                    }
                    title={
                      sortDirection === "asc"
                        ? t("tasks.display.ascending_title")
                        : t("tasks.display.descending_title")
                    }
                    onClick={() =>
                      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
                    }
                  >
                    {sortDirection === "asc" ? (
                      <ArrowUp className="size-3.5" aria-hidden />
                    ) : (
                      <ArrowDown className="size-3.5" aria-hidden />
                    )}
                  </Button>
                ) : null}
              </div>
            </div>

            {viewMode !== "table" ? (
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-caption font-medium text-muted-foreground">
                  {t("tasks.display.show_subtasks")}
                </span>
                <Switch
                  size="sm"
                  checked={showSubTasks}
                  aria-label={t("tasks.display.show_subtasks")}
                  onCheckedChange={() => toggleShowSubTasks()}
                />
              </label>
            ) : null}

            {viewMode !== "table" ? (
              <div>
                <p className="text-caption font-medium text-muted-foreground">
                  {t("tasks.display.card_properties_section")}
                </p>
                <div className="mt-2 space-y-2.5">
                  {CARD_PROPERTY_OPTIONS.map(({ key }) => {
                    const disabled = key === "labels";
                    const label = t(`tasks.display.card_${key}`);
                    return (
                      <label
                        key={key}
                        className="flex cursor-pointer items-center justify-between gap-3 text-body has-data-disabled:cursor-not-allowed has-data-disabled:opacity-60"
                        title={
                          disabled
                            ? t("tasks.display.labels_unavailable")
                            : undefined
                        }
                      >
                        <span>{label}</span>
                        <Switch
                          size="sm"
                          checked={disabled ? false : cardProperties[key]}
                          disabled={disabled}
                          aria-label={label}
                          onCheckedChange={() => toggleCardProperty(key)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
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
