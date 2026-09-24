"use client";

import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type {
  FilterDimension,
  TaskDateFilter,
} from "@uniwork/core/tasks/stores/view-store-types";
import type { TaskViewBaseline } from "@uniwork/core/tasks/views/baseline";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ReactNode } from "react";
import { PAGE_GUTTER } from "../../layout/page-header";
import { useFilterChips, type FilterChip } from "./use-filter-chips";

function ChipSpan({ chip }: { chip: FilterChip }) {
  const { t } = useTranslation();
  return (
    <span className="flex h-6 max-w-72 items-center gap-1.5 rounded-md border border-border bg-muted/40 pl-2 pr-1 text-caption">
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {chip.icon}
        <span>{chip.label}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1">
        {chip.preview}
        <span className="truncate font-medium">{chip.value}</span>
      </span>
      <button
        type="button"
        onClick={chip.onRemove}
        className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("tasks.filters.remove_chip", { label: chip.label })}
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

export function FilterChipsBar({
  workspaceId,
  dateFilter = null,
  onDateFilterChange,
  filterMenu,
  lockProjectFilter = false,
  onSave,
  saveLabel,
  viewBaseline,
}: {
  workspaceId: string;
  dateFilter?: TaskDateFilter | null;
  onDateFilterChange?: (filter: TaskDateFilter | null) => void;
  filterMenu?: ReactNode;
  /** When true, project filter is server-scoped — hide from count/clear. */
  lockProjectFilter?: boolean;
  onSave?: () => void;
  saveLabel?: string;
  /** Open saved view: chips show only the user's additions on top of it. */
  viewBaseline?: TaskViewBaseline;
}) {
  const { t } = useTranslation();
  const { chips, activeCount, clearAll } = useFilterChips(
    workspaceId,
    dateFilter,
    onDateFilterChange,
    viewBaseline,
    lockProjectFilter,
  );

  if (activeCount === 0 && !filterMenu) return null;

  return (
    <div
      data-testid="tasks-filter-chips"
      className={cn(
        "flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 py-1.5",
        PAGE_GUTTER,
      )}
    >
      {filterMenu}
      {chips.map((chip) => (
        <ChipSpan key={chip.key} chip={chip} />
      ))}
      {activeCount > 0 ? (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
            {t("tasks.filters.clear")}
          </Button>
          {onSave && saveLabel ? (
            <Button type="button" variant="outline" size="sm" onClick={onSave}>
              {saveLabel}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export type { FilterDimension };
