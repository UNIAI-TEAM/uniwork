"use client";

import { ChevronLeft, ChevronRight, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import {
  Select,
  SelectContent,
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
import { cn } from "@uniwork/ui/lib/utils";
import { vi as viLocale, enUS } from "date-fns/locale";
import { PAGE_GUTTER } from "../layout/page-header";
import {
  type CalendarViewMode,
  formatPeriodLabel,
  shiftAnchor,
} from "./calendar-view-mode";
import { CalendarExportButton } from "./calendar-export-button";
import { CalendarPeriodPicker } from "./calendar-period-picker";
import { CalendarConnectionsDialog } from "./calendar-connections-dialog";

const VIEW_MODES: CalendarViewMode[] = ["day", "work_week", "week", "month"];

const VIEW_MODE_I18N: Record<CalendarViewMode, string> = {
  day: "calendar.view_day",
  work_week: "calendar.view_work_week",
  week: "calendar.view_week",
  month: "calendar.view_month",
};

function ActionTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function CalendarToolbar({
  anchorDate,
  mine,
  showWeekends,
  viewMode,
  workspaceId,
  exportFrom,
  exportTo,
  isRefreshing,
  onAnchorDateChange,
  onMineChange,
  onRefresh,
  onShowWeekendsChange,
  onViewModeChange,
  className,
}: {
  anchorDate: Date;
  mine: boolean;
  showWeekends: boolean;
  viewMode: CalendarViewMode;
  workspaceId: string;
  exportFrom?: string;
  exportTo?: string;
  isRefreshing: boolean;
  onAnchorDateChange: (next: Date) => void;
  onMineChange: (next: boolean) => void;
  onRefresh: () => void;
  onShowWeekendsChange: (next: boolean) => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "vi" ? viLocale : enUS;
  const periodLabel = formatPeriodLabel(viewMode, anchorDate, locale);
  const viewModeItems = VIEW_MODES.map((mode) => ({
    value: mode,
    label: t(VIEW_MODE_I18N[mode]),
  }));

  return (
    <div
      className={cn(
        "flex h-12 min-w-0 items-center gap-2 border-b border-border",
        PAGE_GUTTER,
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ActionTooltip label={t("calendar.prev_period")}>
          <Button
            type="button"
            size="icon-sm"
            variant="toolbar"
            aria-label={t("calendar.prev_period")}
            onClick={() => onAnchorDateChange(shiftAnchor(viewMode, anchorDate, -1))}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
        </ActionTooltip>
        <ActionTooltip label={t("calendar.next_period")}>
          <Button
            type="button"
            size="icon-sm"
            variant="toolbar"
            aria-label={t("calendar.next_period")}
            onClick={() => onAnchorDateChange(shiftAnchor(viewMode, anchorDate, 1))}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </ActionTooltip>
        <Button
          type="button"
          size="sm"
          variant="toolbar"
          onClick={() => onAnchorDateChange(new Date())}
        >
          {t("calendar.today")}
        </Button>
        <CalendarPeriodPicker
          anchorDate={anchorDate}
          periodLabel={periodLabel}
          onChange={onAnchorDateChange}
        />
        <Select
          value={viewMode}
          onValueChange={(next) => onViewModeChange(next as CalendarViewMode)}
          items={viewModeItems}
        >
          <SelectTrigger
            size="sm"
            variant="subtle"
            aria-label={t("calendar.view_mode")}
            className="w-32 shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {viewModeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <CalendarConnectionsDialog workspaceId={workspaceId} />
        <ActionTooltip label={t(isRefreshing ? "calendar.refreshing" : "calendar.refresh")}>
          <Button
            type="button"
            size="icon-sm"
            variant="toolbar"
            aria-label={t(isRefreshing ? "calendar.refreshing" : "calendar.refresh")}
            aria-busy={isRefreshing || undefined}
            aria-disabled={isRefreshing}
            onClick={onRefresh}
          >
            <RefreshCw
              aria-hidden
              className={cn("size-4", isRefreshing ? "motion-safe:animate-spin" : undefined)}
            />
          </Button>
        </ActionTooltip>
        <CalendarExportButton workspaceId={workspaceId} from={exportFrom} to={exportTo} />
        <Popover>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="toolbar"
                      aria-label={t("calendar.settings")}
                    >
                      <SlidersHorizontal aria-hidden className="size-4" />
                    </Button>
                  }
                />
              }
            />
            <TooltipContent side="bottom">{t("calendar.settings")}</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-56">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-body text-foreground">
                {t("calendar.show_weekends")}
              </span>
              <Switch
                size="sm"
                checked={showWeekends}
                onCheckedChange={onShowWeekendsChange}
              />
            </label>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          size="sm"
          variant="toolbar"
          aria-pressed={mine}
          className="aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90"
          onClick={() => onMineChange(!mine)}
        >
          {t("calendar.mine")}
        </Button>
      </div>
    </div>
  );
}
