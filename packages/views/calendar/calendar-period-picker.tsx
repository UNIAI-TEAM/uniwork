"use client";

import { lazy, Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";

const Calendar = lazy(() =>
  import("@uniwork/ui/components/ui/calendar").then((module) => ({
    default: module.Calendar,
  })),
);

export function CalendarPeriodPicker({
  anchorDate,
  periodLabel,
  onChange,
}: {
  anchorDate: Date;
  periodLabel: string;
  onChange: (next: Date) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="max-w-full gap-1 px-2 font-medium tabular-nums"
            aria-label={t("calendar.period_picker_label", {
              period: periodLabel,
            })}
          />
        }
      >
        <span className="truncate">{periodLabel}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Suspense fallback={<div className="h-72 w-64" aria-hidden />}>
          <Calendar
            mode="single"
            lang={i18n.resolvedLanguage ?? i18n.language}
            selected={anchorDate}
            defaultMonth={anchorDate}
            captionLayout="dropdown"
            startMonth={new Date(anchorDate.getFullYear() - 10, 0, 1)}
            endMonth={new Date(anchorDate.getFullYear() + 10, 11, 31)}
            onSelect={(next) => {
              if (!next) return;
              onChange(next);
              setOpen(false);
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
