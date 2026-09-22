"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";
import { addMonths, format, subMonths } from "date-fns";
import { vi as viLocale, enUS } from "date-fns/locale";
import { PAGE_GUTTER } from "../layout/page-header";

export function CalendarToolbar({
  anchorDate,
  mine,
  onAnchorDateChange,
  onMineChange,
  className,
}: {
  anchorDate: Date;
  mine: boolean;
  onAnchorDateChange: (next: Date) => void;
  onMineChange: (next: boolean) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "vi" ? viLocale : enUS;
  const monthLabel = format(anchorDate, "LLLL yyyy", { locale });

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
          aria-label={t("calendar.prev_month")}
          onClick={() => onAnchorDateChange(subMonths(anchorDate, 1))}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label={t("calendar.next_month")}
          onClick={() => onAnchorDateChange(addMonths(anchorDate, 1))}
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
        <span className="truncate text-body font-medium tabular-nums">{monthLabel}</span>
        <span className="text-caption text-muted-foreground">{t("calendar.view_month")}</span>
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <Switch checked={mine} onCheckedChange={onMineChange} aria-label={t("calendar.mine")} />
        <span className="text-body text-foreground">{t("calendar.mine")}</span>
      </label>
    </div>
  );
}
