"use client";

import { Suspense, lazy, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Check, Clock } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { TimeInput } from "@uniwork/ui/components/ui/time-input";
import { cn } from "@uniwork/ui/lib/utils";

const Calendar = lazy(() =>
  import("@uniwork/ui/components/ui/calendar").then((module) => ({ default: module.Calendar })),
);

const DEFAULT_TIME = "09:00";

export function toDateOnly(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateOnlyToLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toDateOnly(date) === value ? date : undefined;
}

export function splitDateTimePickerValue(value: string): { date: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(value.trim());
  if (!match || !dateOnlyToLocalDate(match[1] as string)) return { date: "", time: "" };
  return { date: match[1] as string, time: match[2] ?? "" };
}

export function joinDateTimePickerValue(date: string, time: string): string {
  if (!date) return "";
  return time ? `${date}T${time}` : date;
}

export interface DateTimePickerProps {
  id?: string;
  /** A local calendar value: "YYYY-MM-DD", "YYYY-MM-DDTHH:mm", or empty. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  modal?: boolean;
  formatOptions?: Intl.DateTimeFormatOptions;
  showIcon?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  triggerRender?: ReactElement<Record<string, unknown>>;
  icon?: ReactNode;
  renderTrigger?: (label: string, selected: boolean) => ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide time controls for date-only fields while retaining the same picker foundation. */
  timeMode?: "hidden" | "optional" | "required";
  hourLabel?: string;
  minuteLabel?: string;
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function DateTimePicker({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  modal = true,
  formatOptions,
  showIcon = true,
  placeholder,
  ariaLabel,
  triggerRender,
  icon,
  renderTrigger,
  open: controlledOpen,
  onOpenChange,
  timeMode = "optional",
  hourLabel,
  minuteLabel,
}: DateTimePickerProps) {
  const { t, i18n } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [pendingTime, setPendingTime] = useState("");
  useEffect(() => setDraftValue(value), [value]);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };
  const parsed = splitDateTimePickerValue(draftValue);
  const selected = dateOnlyToLocalDate(parsed.date);
  const before = min ? dateOnlyToLocalDate(min) : undefined;
  const after = max ? dateOnlyToLocalDate(max) : undefined;
  const effectiveTime = parsed.time || pendingTime || (timeMode === "required" ? DEFAULT_TIME : "");
  const displayDate = selected && effectiveTime
    ? new Date(`${parsed.date}T${effectiveTime}`)
    : selected;
  const displayFormat: Intl.DateTimeFormatOptions = {
    ...(formatOptions ?? { day: "numeric", month: "short", year: "numeric" }),
    ...(effectiveTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  };
  const label = displayDate
    ? displayDate.toLocaleDateString(i18n.language, displayFormat)
    : (placeholder ?? t("common.date_pick"));
  const today = new Date();
  const quickDates = [
    { label: t("common.today"), date: today },
    { label: t("common.tomorrow"), date: addLocalDays(today, 1) },
  ];

  const emit = (next: string) => {
    setDraftValue(next);
    onChange(next);
  };

  const chooseDate = (date: Date | undefined) => {
    const nextDate = date ? toDateOnly(date) : "";
    const nextTime = timeMode === "required" ? (effectiveTime || DEFAULT_TIME) : effectiveTime;
    emit(joinDateTimePickerValue(nextDate, nextTime));
    if (timeMode === "hidden") setOpen(false);
  };

  return (
    <Popover modal={modal} open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        render={triggerRender}
        className={
          triggerRender
            ? undefined
            : cn(
                "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-left text-body transition-colors outline-none pointer-coarse:min-h-11 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
                !selected && "text-muted-foreground",
                className,
              )
        }
      >
        {renderTrigger ? (
          renderTrigger(label, Boolean(selected))
        ) : (
          <>
            {showIcon
              ? (icon ?? <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />)
              : null}
            <span className="truncate">{label}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto overflow-hidden p-0 overscroll-contain" align="start">
        <div className="grid grid-cols-2 gap-1 border-b p-2">
          {quickDates.map((quickDate) => (
            <Button
              key={quickDate.label}
              type="button"
              variant="ghost"
              size="sm"
              className="justify-between font-normal"
              onClick={() => chooseDate(quickDate.date)}
            >
              <span>{quickDate.label}</span>
              <span className="text-caption text-muted-foreground">
                {quickDate.date.toLocaleDateString(i18n.language, { weekday: "short" })}
              </span>
            </Button>
          ))}
        </div>
        <Suspense fallback={<div className="h-72 w-64" aria-hidden="true" />}>
          <Calendar
            mode="single"
            lang={i18n.language}
            selected={selected}
            defaultMonth={selected}
            disabled={[...(before ? [{ before }] : []), ...(after ? [{ after }] : [])]}
            onSelect={chooseDate}
          />
        </Suspense>
        <div className="flex min-h-12 items-center gap-2 border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto font-normal text-muted-foreground"
            onClick={() => emit("")}
          >
            {t("common.date_clear")}
            <Check aria-hidden="true" className={cn("size-3.5", selected && "invisible")} />
          </Button>
          {timeMode !== "hidden" ? (
            effectiveTime ? (
              <>
                <TimeInput
                  className="w-auto"
                  value={effectiveTime}
                  showIcon={false}
                  hourLabel={hourLabel ?? t("common.hour")}
                  minuteLabel={minuteLabel ?? t("common.minute")}
                  onChange={(next) => {
                    if (parsed.date) emit(joinDateTimePickerValue(parsed.date, next));
                    else setPendingTime(next);
                  }}
                />
                {timeMode === "optional" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => emit(parsed.date)}
                  >
                    {t("common.all_day")}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!parsed.date}
                onClick={() => emit(joinDateTimePickerValue(parsed.date, DEFAULT_TIME))}
              >
                <Clock aria-hidden="true" className="size-3.5" />
                {t("common.time_add")}
              </Button>
            )
          ) : null}
          {timeMode !== "hidden" ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t("common.done")}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
