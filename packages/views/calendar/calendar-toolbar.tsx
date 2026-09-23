"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
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

const VIEW_MODES: CalendarViewMode[] = ["day", "work_week", "week", "month"];

const VIEW_MODE_I18N: Record<CalendarViewMode, string> = {
  day: "calendar.view_day",
  work_week: "calendar.view_work_week",
  week: "calendar.view_week",
  month: "calendar.view_month",
};

const SEGMENT =
  "h-7 gap-1.5 rounded-md border border-transparent px-2.5 text-label font-medium text-muted-foreground pointer-coarse:h-10 " +
  "hover:bg-transparent hover:text-foreground aria-pressed:border-border aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-[var(--surface-shadow)] aria-pressed:hover:bg-surface";

export function CalendarToolbar({
  anchorDate,
  mine,
  viewMode,
  workspaceId,
  exportFrom,
  exportTo,
  onAnchorDateChange,
  onMineChange,
  onViewModeChange,
  className,
}: {
  anchorDate: Date;
  mine: boolean;
  viewMode: CalendarViewMode;
  workspaceId: string;
  exportFrom?: string;
  exportTo?: string;
  onAnchorDateChange: (next: Date) => void;
  onMineChange: (next: boolean) => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "vi" ? viLocale : enUS;
  const periodLabel = formatPeriodLabel(viewMode, anchorDate, locale);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b border-border py-3",
        PAGE_GUTTER,
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("calendar.prev_period")}
          onClick={() => onAnchorDateChange(shiftAnchor(viewMode, anchorDate, -1))}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("calendar.next_period")}
          onClick={() => onAnchorDateChange(shiftAnchor(viewMode, anchorDate, 1))}
        >
          <ChevronRight aria-hidden className="size-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onAnchorDateChange(new Date())}
        >
          {t("calendar.today")}
        </Button>
        <CalendarPeriodPicker
          anchorDate={anchorDate}
          periodLabel={periodLabel}
          onChange={onAnchorDateChange}
        />
        <ToggleGroup
          value={[viewMode]}
          onValueChange={(v) => {
            const next = v[0] as CalendarViewMode | undefined;
            if (next) onViewModeChange(next);
          }}
          aria-label={t("calendar.view_mode")}
          spacing={0.5}
          className="shrink-0 rounded-lg bg-muted p-0.5 pointer-coarse:p-0.5"
        >
          {VIEW_MODES.map((mode) => (
            <ToggleGroupItem key={mode} value={mode} className={SEGMENT}>
              {t(VIEW_MODE_I18N[mode])}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <CalendarExportButton workspaceId={workspaceId} from={exportFrom} to={exportTo} />
        <label className="flex cursor-pointer items-center gap-2">
          <Switch checked={mine} onCheckedChange={onMineChange} aria-label={t("calendar.mine")} />
          <span className="text-body text-foreground">{t("calendar.mine")}</span>
        </label>
      </div>
    </div>
  );
}
