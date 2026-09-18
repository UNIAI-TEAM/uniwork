"use client";

import {
  cloneElement,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  CalendarDays,
  CircleDot,
  FolderKanban,
  SignalHigh,
  SlidersHorizontal,
  Tag,
  User,
  UserRoundPen,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TableFacetsResult } from "@uniwork/core/api/endpoints/tasks-table";
import { useTaskProperties, useTaskStatuses } from "@uniwork/core/tasks";
import {
  useViewStore,
  useViewStoreApi,
} from "@uniwork/core/tasks/stores/view-store-context";
import type { TaskDateFilter } from "@uniwork/core/tasks/stores/view-store-types";
import type { TaskViewBaseline } from "@uniwork/core/tasks/views/baseline";
import { TASK_PRIORITIES, TASK_STATUSES, type Task } from "@uniwork/core/types";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { useWorkspaceId } from "../../layout/workspace-context";
import { PriorityIcon } from "../icons/priority-icon";
import { StatusIcon } from "../icons/status-icon";
import { FilterAssigneeOptions } from "./filter-assignee-options";
import {
  getActiveFilterCount,
  useTaskFilterCounts,
  type TaskTableFacetSpec,
} from "./filter-counts";
import { FilterDatePanel } from "./filter-date-panel";
import { FilterLabelOptions } from "./filter-label-options";
import {
  FilterPropertyOptions,
  isFilterableProperty,
} from "./filter-property-options";
import { FilterProjectOptions } from "./filter-project-options";
import { FILTER_ITEM_CLASS, HoverCheck } from "./hover-check";

const NO_COUNT_TASKS: Task[] = [];

function shortDateLabel(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  if (!y || !m || !d) return dateOnly;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(y, m - 1, d));
}

export function TaskFilterMenu({
  trigger,
  tooltip,
  scopedTasks = NO_COUNT_TASKS,
  tableFacetCounts,
  onTableFacetChange,
  dateFilter: dateFilterProp,
  onDateFilterChange,
  onOpenChange,
  freezeAnchor = false,
  viewBaseline,
  lockProjectFilter = false,
}: {
  trigger: ReactElement;
  tooltip?: string;
  scopedTasks?: Task[];
  tableFacetCounts?: TableFacetsResult;
  onTableFacetChange?: (facet: TaskTableFacetSpec | null) => void;
  dateFilter?: TaskDateFilter | null;
  onDateFilterChange?: (filter: TaskDateFilter | null) => void;
  onOpenChange?: (open: boolean) => void;
  freezeAnchor?: boolean;
  viewBaseline?: TaskViewBaseline;
  lockProjectFilter?: boolean;
}) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLElement>(null);
  const [frozenAnchor, setFrozenAnchor] = useState<{
    getBoundingClientRect: () => DOMRect;
  } | null>(null);

  const statusFilters = useViewStore((s) => s.statusFilters);
  const priorityFilters = useViewStore((s) => s.priorityFilters);
  const assigneeFilters = useViewStore((s) => s.assigneeFilters);
  const includeNoAssignee = useViewStore((s) => s.includeNoAssignee);
  const creatorFilters = useViewStore((s) => s.creatorFilters);
  const projectFilters = useViewStore((s) => s.projectFilters);
  const includeNoProject = useViewStore((s) => s.includeNoProject);
  const labelFilters = useViewStore((s) => s.labelFilters);
  const propertyFilters = useViewStore((s) => s.propertyFilters);
  const storeDateFilter = useViewStore((s) => s.dateFilter);
  const setDateFilter = useViewStore((s) => s.setDateFilter);
  const act = useViewStoreApi().getState();

  const wsId = useWorkspaceId();
  const { data: statusList } = useTaskStatuses(wsId);
  const { data: propertyList } = useTaskProperties(wsId);

  const catalogStatuses = statusList?.statuses ?? [];
  const statusOptions =
    catalogStatuses.length > 0
      ? catalogStatuses
          .filter((s) => !s.archived_at)
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((s) => ({
            key: s.key,
            label: s.name || t(`tasks.status_${s.key}`, { defaultValue: s.key }),
            category: s.category,
            color: s.color,
          }))
      : TASK_STATUSES.map((key) => ({
          key,
          label: t(`tasks.status_${key}`),
          category: key,
          color: undefined as string | undefined,
        }));

  const filterableProperties = useMemo(
    () => (propertyList?.properties ?? []).filter(isFilterableProperty),
    [propertyList?.properties],
  );

  const counts = useTaskFilterCounts(scopedTasks, tableFacetCounts);
  const dateFilter =
    dateFilterProp !== undefined ? dateFilterProp : storeDateFilter;

  const handleDateFilterChange = (next: TaskDateFilter | null) => {
    setDateFilter(next);
    onDateFilterChange?.(next);
  };

  const effectivePropertyFilters = useMemo(() => {
    const activeIds = new Set(filterableProperties.map((p) => p.id));
    return Object.fromEntries(
      Object.entries(propertyFilters).filter(
        ([id, selected]) => selected.length > 0 && activeIds.has(id),
      ),
    );
  }, [filterableProperties, propertyFilters]);

  const hasActiveFilters =
    getActiveFilterCount(
      {
        statusFilters,
        priorityFilters,
        propertyFilters: effectivePropertyFilters,
        assigneeFilters,
        includeNoAssignee,
        creatorFilters,
        projectFilters,
        includeNoProject,
        labelFilters,
        dateFilter,
      },
      viewBaseline,
      lockProjectFilter,
    ) > 0;

  const fixedTitle = viewBaseline ? t("tasks.filters.in_view") : undefined;
  const dateFilterLabel = dateFilter
    ? `${t(
        dateFilter.field === "updated_at"
          ? "tasks.filters.date_field_updated"
          : "tasks.filters.date_field_created",
      )}: ${
        dateFilter.from === dateFilter.to
          ? shortDateLabel(dateFilter.from)
          : `${shortDateLabel(dateFilter.from)} - ${shortDateLabel(dateFilter.to)}`
      }`
    : null;

  const anchoredTrigger = freezeAnchor
    ? cloneElement(trigger, {
        ref: triggerRef,
      } as Partial<React.HTMLAttributes<HTMLElement>>)
    : trigger;

  const facetOpen =
    (kind: TaskTableFacetSpec["kind"], propertyId?: string) =>
    (open: boolean) => {
      if (!open) {
        onTableFacetChange?.(null);
        return;
      }
      if (kind === "property" && propertyId) {
        onTableFacetChange?.({ kind: "property", property_id: propertyId });
        return;
      }
      if (kind !== "property") {
        onTableFacetChange?.({ kind });
      }
    };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (freezeAnchor) {
          if (open && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setFrozenAnchor({ getBoundingClientRect: () => rect });
          } else if (!open) {
            setFrozenAnchor(null);
          }
        }
        if (!open) onTableFacetChange?.(null);
        onOpenChange?.(open);
      }}
    >
      {tooltip ? (
        <Tooltip>
          <DropdownMenuTrigger
            render={<TooltipTrigger render={anchoredTrigger} />}
          />
          <TooltipContent side="bottom">{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger render={anchoredTrigger} />
      )}
      <DropdownMenuContent
        align="end"
        className="w-auto"
        anchor={frozenAnchor ?? undefined}
      >
        <DropdownMenuSub onOpenChange={facetOpen("status")}>
          <DropdownMenuSubTrigger data-testid="task-filter-section-status">
            <CircleDot className="size-3.5" aria-hidden />
            <span className="flex-1">{t("tasks.filters.status")}</span>
            {statusFilters.length > 0 ? (
              <span className="text-caption font-medium text-primary">
                {statusFilters.length}
              </span>
            ) : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto min-w-48">
            {statusOptions.map((option) => {
              const checked = statusFilters.includes(option.key);
              const count = counts.status.get(option.key) ?? 0;
              const fixed = viewBaseline?.status.has(option.key) === true;
              return (
                <DropdownMenuCheckboxItem
                  key={option.key}
                  checked={checked}
                  disabled={fixed}
                  title={fixed ? fixedTitle : undefined}
                  onCheckedChange={() => act.toggleStatusFilter(option.key)}
                  className={FILTER_ITEM_CLASS}
                  data-testid={`task-filter-status-${option.key}`}
                >
                  <HoverCheck checked={checked} />
                  <StatusIcon
                    status={option.key}
                    category={option.category}
                    color={option.color}
                    className="h-3.5 w-3.5"
                  />
                  {option.label}
                  {count > 0 ? (
                    <span className="ml-auto text-caption text-muted-foreground">
                      {t("tasks.filters.task_count", { count })}
                    </span>
                  ) : null}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub onOpenChange={facetOpen("priority")}>
          <DropdownMenuSubTrigger>
            <SignalHigh className="size-3.5" aria-hidden />
            <span className="flex-1">{t("tasks.filters.priority")}</span>
            {priorityFilters.length > 0 ? (
              <span className="text-caption font-medium text-primary">
                {priorityFilters.length}
              </span>
            ) : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto min-w-44">
            {TASK_PRIORITIES.map((p) => {
              const checked = priorityFilters.includes(p);
              const count = counts.priority.get(p) ?? 0;
              const fixed = viewBaseline?.priority.has(p) === true;
              return (
                <DropdownMenuCheckboxItem
                  key={p}
                  checked={checked}
                  disabled={fixed}
                  title={fixed ? fixedTitle : undefined}
                  onCheckedChange={() => act.togglePriorityFilter(p)}
                  className={FILTER_ITEM_CLASS}
                >
                  <HoverCheck checked={checked} />
                  <PriorityIcon priority={p} />
                  {t(`tasks.priority_${p}`)}
                  {count > 0 ? (
                    <span className="ml-auto text-caption text-muted-foreground">
                      {t("tasks.filters.task_count", { count })}
                    </span>
                  ) : null}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="task-filter-section-date">
            <CalendarDays className="size-3.5" aria-hidden />
            <span className="flex-1">{t("tasks.filters.date")}</span>
            {dateFilterLabel ? (
              <span className="max-w-36 truncate text-caption font-medium text-primary">
                {dateFilterLabel}
              </span>
            ) : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <FilterDatePanel
              value={dateFilter}
              onChange={handleDateFilterChange}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub onOpenChange={facetOpen("assignee")}>
          <DropdownMenuSubTrigger data-testid="task-filter-section-assignee">
            <User className="size-3.5" aria-hidden />
            <span className="flex-1">{t("tasks.filters.assignee")}</span>
            {assigneeFilters.length > 0 || includeNoAssignee ? (
              <span className="text-caption font-medium text-primary">
                {assigneeFilters.length + (includeNoAssignee ? 1 : 0)}
              </span>
            ) : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto min-w-52 p-0">
            <FilterAssigneeOptions
              counts={counts.assignee}
              selected={assigneeFilters}
              onToggle={act.toggleAssigneeFilter}
              showNoAssignee
              includeNoAssignee={includeNoAssignee}
              onToggleNoAssignee={act.toggleNoAssignee}
              noAssigneeCount={counts.noAssignee}
              fixedKeys={viewBaseline?.assignee}
              noAssigneeFixed={viewBaseline?.includeNoAssignee === true}
              fixedTitle={fixedTitle}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub onOpenChange={facetOpen("creator")}>
          <DropdownMenuSubTrigger>
            <UserRoundPen className="size-3.5" aria-hidden />
            <span className="flex-1">{t("tasks.filters.creator")}</span>
            {creatorFilters.length > 0 ? (
              <span className="text-caption font-medium text-primary">
                {creatorFilters.length}
              </span>
            ) : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto min-w-52 p-0">
            <FilterAssigneeOptions
              counts={counts.creator}
              selected={creatorFilters}
              onToggle={act.toggleCreatorFilter}
              showSquads={false}
              fixedKeys={viewBaseline?.creator}
              fixedTitle={fixedTitle}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {!lockProjectFilter ? (
          <DropdownMenuSub onOpenChange={facetOpen("project")}>
            <DropdownMenuSubTrigger>
              <FolderKanban className="size-3.5" aria-hidden />
              <span className="flex-1">{t("tasks.filters.project")}</span>
              {projectFilters.length > 0 || includeNoProject ? (
                <span className="text-caption font-medium text-primary">
                  {projectFilters.length + (includeNoProject ? 1 : 0)}
                </span>
              ) : null}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-auto min-w-52 p-0">
              <FilterProjectOptions
                counts={counts.project}
                selected={projectFilters}
                onToggle={act.toggleProjectFilter}
                includeNoProject={includeNoProject}
                onToggleNoProject={act.toggleNoProject}
                noProjectCount={counts.noProject}
                fixedIds={viewBaseline?.project}
                noProjectFixed={viewBaseline?.includeNoProject === true}
                fixedTitle={fixedTitle}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}

        <DropdownMenuSub onOpenChange={facetOpen("label")}>
          <DropdownMenuSubTrigger>
            <Tag className="size-3.5" aria-hidden />
            <span className="flex-1">{t("tasks.filters.label")}</span>
            {labelFilters.length > 0 ? (
              <span className="text-caption font-medium text-primary">
                {labelFilters.length}
              </span>
            ) : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-auto min-w-52 p-0">
            <FilterLabelOptions
              counts={counts.label}
              selected={labelFilters}
              onToggle={act.toggleLabelFilter}
              fixedIds={viewBaseline?.label}
              fixedTitle={fixedTitle}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {filterableProperties.length > 0 ? <DropdownMenuSeparator /> : null}
        {filterableProperties.map((property) => {
          const selected = propertyFilters[property.id] ?? [];
          return (
            <DropdownMenuSub
              key={property.id}
              onOpenChange={facetOpen("property", property.id)}
            >
              <DropdownMenuSubTrigger>
                <SlidersHorizontal className="size-3.5" aria-hidden />
                <span className="flex-1 truncate">{property.name}</span>
                {selected.length > 0 ? (
                  <span className="text-caption font-medium text-primary">
                    {selected.length}
                  </span>
                ) : null}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-auto min-w-44 p-1">
                <FilterPropertyOptions
                  property={property}
                  counts={counts.property.get(property.id)}
                  selected={selected}
                  onToggle={(optionId) =>
                    act.togglePropertyFilter(property.id, optionId)
                  }
                  fixedIds={viewBaseline?.property.get(property.id)}
                  fixedTitle={fixedTitle}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}

        {hasActiveFilters ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                if (viewBaseline) {
                  act.resetFiltersTo(viewBaseline.raw);
                } else {
                  act.clearFilters();
                }
                handleDateFilterChange(null);
              }}
            >
              {t("tasks.filters.reset")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
