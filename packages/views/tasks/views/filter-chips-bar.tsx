"use client";

import { useMemo, type ReactNode } from "react";
import {
  CalendarDays,
  CircleDot,
  Filter,
  SignalHigh,
  User,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import type {
  FilterDimension,
  FilterSnapshot,
  TaskDateFilter,
} from "@uniwork/core/tasks/stores/view-store-types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { PAGE_GUTTER } from "../../layout/page-header";

interface FilterChip {
  key: string;
  icon: ReactNode;
  label: string;
  value: string;
  onRemove?: () => void;
}

const CHIP_ICON = "size-3 shrink-0 text-muted-foreground";

function getActiveFilterCount(
  snapshot: FilterSnapshot,
  dateFilter: TaskDateFilter | null,
): number {
  let n = 0;
  if (snapshot.statusFilters.length) n += 1;
  if (snapshot.priorityFilters.length) n += 1;
  if (snapshot.assigneeFilters.length || snapshot.includeNoAssignee) n += 1;
  if (snapshot.creatorFilters.length) n += 1;
  if (snapshot.projectFilters.length || snapshot.includeNoProject) n += 1;
  if (snapshot.labelFilters.length) n += 1;
  n += Object.values(snapshot.propertyFilters).filter((v) => v.length > 0)
    .length;
  if (dateFilter) n += 1;
  return n;
}

export function FilterChipsBar({
  dateFilter = null,
  onDateFilterChange,
  onSave,
  saveLabel,
  filterMenu,
}: {
  dateFilter?: TaskDateFilter | null;
  onDateFilterChange?: (filter: TaskDateFilter | null) => void;
  onSave?: () => void;
  saveLabel?: string;
  filterMenu?: ReactNode;
}) {
  const { t } = useTranslation();
  const statusFilters = useViewStore((s) => s.statusFilters);
  const priorityFilters = useViewStore((s) => s.priorityFilters);
  const assigneeFilters = useViewStore((s) => s.assigneeFilters);
  const includeNoAssignee = useViewStore((s) => s.includeNoAssignee);
  const creatorFilters = useViewStore((s) => s.creatorFilters);
  const projectFilters = useViewStore((s) => s.projectFilters);
  const includeNoProject = useViewStore((s) => s.includeNoProject);
  const labelFilters = useViewStore((s) => s.labelFilters);
  const propertyFilters = useViewStore((s) => s.propertyFilters);
  const clearFilters = useViewStore((s) => s.clearFilters);
  const clearFilterDimension = useViewStore((s) => s.clearFilterDimension);
  const setDateFilter = useViewStore((s) => s.setDateFilter);

  const snapshot: FilterSnapshot = useMemo(
    () => ({
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
      labelFilters,
      propertyFilters,
    }),
    [
      statusFilters,
      priorityFilters,
      assigneeFilters,
      includeNoAssignee,
      creatorFilters,
      projectFilters,
      includeNoProject,
      labelFilters,
      propertyFilters,
    ],
  );

  const chips: FilterChip[] = useMemo(() => {
    const next: FilterChip[] = [];
    if (statusFilters.length > 0) {
      next.push({
        key: "status",
        icon: <CircleDot className={CHIP_ICON} aria-hidden />,
        label: t("tasks.filters.status"),
        value:
          statusFilters.length === 1
            ? t(`tasks.status_${statusFilters[0]}`)
            : t("tasks.filters.count_values", { count: statusFilters.length }),
        onRemove: () => clearFilterDimension("status"),
      });
    }
    if (priorityFilters.length > 0) {
      next.push({
        key: "priority",
        icon: <SignalHigh className={CHIP_ICON} aria-hidden />,
        label: t("tasks.filters.priority"),
        value:
          priorityFilters.length === 1
            ? t(`tasks.priority_${priorityFilters[0]}`)
            : t("tasks.filters.count_values", { count: priorityFilters.length }),
        onRemove: () => clearFilterDimension("priority"),
      });
    }
    if (assigneeFilters.length > 0 || includeNoAssignee) {
      next.push({
        key: "assignee",
        icon: <User className={CHIP_ICON} aria-hidden />,
        label: t("tasks.filters.assignee"),
        value: includeNoAssignee
          ? t("tasks.unassigned")
          : t("tasks.filters.count_values", { count: assigneeFilters.length }),
        onRemove: () => clearFilterDimension("assignee"),
      });
    }
    if (dateFilter) {
      next.push({
        key: "date",
        icon: <CalendarDays className={CHIP_ICON} aria-hidden />,
        label: t("tasks.filters.date"),
        value: `${dateFilter.from} – ${dateFilter.to}`,
        onRemove: () => {
          setDateFilter(null);
          onDateFilterChange?.(null);
        },
      });
    }
    return next;
  }, [
    assigneeFilters.length,
    clearFilterDimension,
    dateFilter,
    includeNoAssignee,
    onDateFilterChange,
    priorityFilters,
    setDateFilter,
    statusFilters,
    t,
  ]);

  const activeCount = getActiveFilterCount(snapshot, dateFilter);
  if (activeCount === 0 && !filterMenu && !onSave) return null;

  return (
    <div
      className={cn(
        "flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 py-1.5",
        PAGE_GUTTER,
      )}
    >
      {filterMenu ?? (
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Filter className="size-3.5" aria-hidden />
          {t("tasks.filters.add")}
        </Button>
      )}
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-caption"
        >
          {chip.icon}
          <span className="text-muted-foreground">{chip.label}</span>
          <span className="truncate font-medium">{chip.value}</span>
          {chip.onRemove ? (
            <button
              type="button"
              onClick={chip.onRemove}
              className="rounded p-0.5 hover:bg-accent"
              aria-label={t("tasks.filters.remove_chip", { label: chip.label })}
            >
              <X className="size-3" aria-hidden />
            </button>
          ) : null}
        </span>
      ))}
      {activeCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            clearFilters();
            onDateFilterChange?.(null);
          }}
        >
          {t("tasks.filters.clear")}
        </Button>
      ) : null}
      {onSave ? (
        <Button type="button" variant="outline" size="sm" onClick={onSave}>
          {saveLabel ?? t("tasks.filters.chip_save")}
        </Button>
      ) : null}
    </div>
  );
}

export type { FilterDimension };
