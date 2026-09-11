"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  CARD_PROPERTY_OPTIONS,
  GROUPING_OPTIONS,
  SORT_OPTIONS,
  SWIMLANE_GROUPINGS,
  type SortField,
  type SwimlaneGrouping,
  type TableGrouping,
  type TaskGrouping,
  type TaskViewMode,
} from "@uniwork/core/tasks/stores/view-store";
import type { GanttZoom } from "@uniwork/core/tasks/stores/view-store-types";
import { useViewStore } from "@uniwork/core/tasks/stores/view-store-context";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";

const ALL_VIEW_MODES: TaskViewMode[] = [
  "list",
  "board",
  "table",
  "swimlane",
  "gantt",
];

const TABLE_GROUPINGS: TableGrouping[] = [
  "none",
  "status",
  "assignee",
  "project",
];

const GANTT_ZOOMS: GanttZoom[] = ["day", "week", "month"];

export function TaskDisplaySummary() {
  const { t } = useTranslation();
  const viewMode = useViewStore((s) => s.viewMode);
  const grouping = useViewStore((s) => s.grouping);
  const swimlaneGrouping = useViewStore((s) => s.swimlaneGrouping);
  const tableGrouping = useViewStore((s) => s.tableGrouping);
  const sortBy = useViewStore((s) => s.sortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);

  const group =
    viewMode === "board"
      ? grouping
      : viewMode === "swimlane"
        ? swimlaneGrouping
        : viewMode === "table"
          ? tableGrouping
          : null;

  return (
    <span className="truncate text-caption text-muted-foreground">
      {[
        t(`tasks.view.${viewMode}`),
        group ? t(`tasks.display.group_${group}`) : null,
        t(`tasks.display.sort_${sortBy}`),
        sortDirection === "asc"
          ? t("tasks.display.ascending_title")
          : t("tasks.display.descending_title"),
      ]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

export function TaskDisplaySettings({
  showMode = false,
  modes = ALL_VIEW_MODES,
  showProjectGrouping = true,
  projectGroupingDisabled = false,
  projectGroupingReasonKey,
  labelsDisabled = false,
  compact = false,
}: {
  showMode?: boolean;
  modes?: TaskViewMode[];
  showProjectGrouping?: boolean;
  projectGroupingDisabled?: boolean;
  projectGroupingReasonKey?: string;
  labelsDisabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const viewMode = useViewStore((s) => s.viewMode);
  const setViewMode = useViewStore((s) => s.setViewMode);
  const grouping = useViewStore((s) => s.grouping);
  const setGrouping = useViewStore((s) => s.setGrouping);
  const swimlaneGrouping = useViewStore((s) => s.swimlaneGrouping);
  const setSwimlaneGrouping = useViewStore((s) => s.setSwimlaneGrouping);
  const tableGrouping = useViewStore((s) => s.tableGrouping);
  const setTableGrouping = useViewStore((s) => s.setTableGrouping);
  const tableHierarchy = useViewStore((s) => s.tableHierarchy);
  const toggleTableHierarchy = useViewStore((s) => s.toggleTableHierarchy);
  const ganttZoom = useViewStore((s) => s.ganttZoom);
  const setGanttZoom = useViewStore((s) => s.setGanttZoom);
  const ganttShowCompleted = useViewStore((s) => s.ganttShowCompleted);
  const toggleGanttShowCompleted = useViewStore(
    (s) => s.toggleGanttShowCompleted,
  );
  const sortBy = useViewStore((s) => s.sortBy);
  const setSortBy = useViewStore((s) => s.setSortBy);
  const sortDirection = useViewStore((s) => s.sortDirection);
  const setSortDirection = useViewStore((s) => s.setSortDirection);
  const showSubTasks = useViewStore((s) => s.showSubTasks);
  const toggleShowSubTasks = useViewStore((s) => s.toggleShowSubTasks);
  const cardProperties = useViewStore((s) => s.cardProperties);
  const toggleCardProperty = useViewStore((s) => s.toggleCardProperty);

  const allowedGrouping = GROUPING_OPTIONS.filter(
    ({ value }) => value !== "project" || showProjectGrouping,
  );
  const effectiveGrouping = allowedGrouping.some(({ value }) => value === grouping)
    ? grouping
    : "status";
  const effectiveSort = SORT_OPTIONS.some(({ value }) => value === sortBy)
    ? sortBy
    : "position";
  const groupingReason = projectGroupingReasonKey
    ? t(projectGroupingReasonKey)
    : t("tasks.surface.grouping_unavailable");

  return (
    <div className={cn("space-y-3", compact && "space-y-2.5")}>
      {showMode ? (
        <div
          className={cn(
            "grid gap-1.5",
            compact && "grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3",
          )}
        >
          <Label htmlFor="saved-view-layout">
            {t("tasks.save_view.layout")}
          </Label>
          <Select
            id="saved-view-layout"
            items={modes.map((mode) => ({
              value: mode,
              label: t(`tasks.view.${mode}`),
            }))}
            value={modes.includes(viewMode) ? viewMode : modes[0]}
            onValueChange={(value) => {
              if (value && modes.includes(value as TaskViewMode)) {
                setViewMode(value as TaskViewMode);
              }
            }}
          />
        </div>
      ) : null}

      {viewMode === "board" ? (
        <SettingSelect
          id="saved-view-grouping"
          label={t("tasks.display.grouping_section")}
          value={effectiveGrouping}
          items={allowedGrouping.map(({ value }) => ({
            value,
            label: t(`tasks.display.group_${value}`),
            disabled: value === "project" && projectGroupingDisabled,
          }))}
          disabledReason={groupingReason}
          compact={compact}
          onValueChange={(value) => setGrouping(value as TaskGrouping)}
        />
      ) : null}

      {viewMode === "swimlane" ? (
        <SettingSelect
          id="saved-view-swimlane-grouping"
          label={t("tasks.display.grouping_section")}
          value={swimlaneGrouping}
          items={SWIMLANE_GROUPINGS.map((value) => ({
            value,
            label: t(`tasks.display.group_${value}`),
            disabled:
              value === "parent" ||
              (value === "project" && projectGroupingDisabled),
          }))}
          disabledReason={groupingReason}
          compact={compact}
          onValueChange={(value) =>
            setSwimlaneGrouping(value as SwimlaneGrouping)
          }
        />
      ) : null}

      {viewMode === "table" ? (
        <>
          <SettingSelect
            id="saved-view-table-grouping"
            label={t("tasks.display.grouping_section")}
            value={tableGrouping}
            items={TABLE_GROUPINGS.map((value) => ({
              value,
              label: t(`tasks.display.group_${value}`),
              disabled: value === "project" && projectGroupingDisabled,
            }))}
            disabledReason={groupingReason}
            compact={compact}
            onValueChange={(value) =>
              setTableGrouping(value as TableGrouping)
            }
          />
          <SettingSwitch
            label={t("tasks.save_view.table_hierarchy")}
            checked={tableHierarchy}
            onCheckedChange={toggleTableHierarchy}
            compact={compact}
          />
        </>
      ) : null}

      {viewMode === "gantt" ? (
        <>
          <SettingSelect
            id="saved-view-gantt-zoom"
            label={t("tasks.save_view.gantt_zoom")}
            value={ganttZoom}
            items={GANTT_ZOOMS.map((value) => ({
              value,
              label: t(`tasks.gantt.zoom_${value}`),
            }))}
            onValueChange={(value) => setGanttZoom(value as GanttZoom)}
            compact={compact}
          />
          <SettingSwitch
            label={t("tasks.gantt.show_completed")}
            checked={ganttShowCompleted}
            onCheckedChange={toggleGanttShowCompleted}
            compact={compact}
          />
        </>
      ) : null}

      <div
        className={cn(
          "flex items-center justify-between gap-3",
          compact && "grid grid-cols-[5.5rem_minmax(0,1fr)]",
        )}
      >
        <Label htmlFor="saved-view-sort">
          {t("tasks.display.ordering_section")}
        </Label>
        <div className="flex min-w-0 items-center gap-1.5">
          <div className={compact ? "min-w-0 flex-1" : undefined}>
            <Select
              id="saved-view-sort"
              items={SORT_OPTIONS.map(({ value }) => ({
                value,
                label: t(`tasks.display.sort_${value}`),
              }))}
              value={effectiveSort}
              onValueChange={(value) => {
                if (value) setSortBy(value as SortField);
              }}
            />
          </div>
          {effectiveSort !== "position" ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={
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
        <SettingSwitch
          label={t("tasks.display.show_subtasks")}
          checked={showSubTasks}
          onCheckedChange={toggleShowSubTasks}
          compact={compact}
        />
      ) : null}

      {viewMode !== "table" && viewMode !== "gantt" ? (
        <div className="border-t border-border pt-3">
          <p className="text-caption font-medium text-muted-foreground">
            {t("tasks.display.card_properties_section")}
          </p>
          <div
            className={cn(
              "mt-2 space-y-2.5",
              compact && "grid grid-cols-2 gap-x-5 gap-y-2 space-y-0",
            )}
          >
            {CARD_PROPERTY_OPTIONS.map(({ key }) => (
              <SettingSwitch
                key={key}
                label={t(`tasks.display.card_${key}`)}
                checked={labelsDisabled && key === "labels" ? false : cardProperties[key]}
                disabled={labelsDisabled && key === "labels"}
                disabledReason={
                  labelsDisabled && key === "labels"
                    ? t("tasks.display.labels_unavailable")
                    : undefined
                }
                onCheckedChange={() => toggleCardProperty(key)}
                compact={compact}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingSwitch({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  disabledReason,
  compact = false,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: () => void;
  disabled?: boolean;
  disabledReason?: string;
  compact?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 text-body has-data-disabled:cursor-not-allowed has-data-disabled:opacity-60",
        compact && "min-w-0 rounded-md px-1 py-0.5",
      )}
      title={disabled ? disabledReason : undefined}
    >
      <span>{label}</span>
      <Switch
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </label>
  );
}

function SettingSelect({
  id,
  label,
  value,
  items,
  disabledReason,
  onValueChange,
  compact = false,
}: {
  id: string;
  label: string;
  value: string;
  items: Array<{ value: string; label: string; disabled?: boolean }>;
  disabledReason?: string;
  onValueChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        compact && "grid grid-cols-[5.5rem_minmax(0,1fr)]",
      )}
    >
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        items={items.map(({ value: itemValue, label: itemLabel }) => ({
          value: itemValue,
          label: itemLabel,
        }))}
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next);
        }}
      >
        <SelectTrigger className={compact ? "w-full" : "w-40"} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {items.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              disabled={item.disabled}
              title={item.disabled ? disabledReason : undefined}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
