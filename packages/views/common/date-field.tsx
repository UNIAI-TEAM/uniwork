"use client";

import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";

// react-day-picker + date-fns is ~24 KB gzip and nothing renders it before the
// popover opens, so it loads on that click instead of in every route that has a
// date field (scripts/bundle-budget.mjs).
const Calendar = lazy(() =>
  import("@uniwork/ui/components/ui/calendar").then((m) => ({ default: m.Calendar })),
);

/** "YYYY-MM-DD" → local Date (no timezone shift), or undefined when empty/invalid. */
export function dateOnlyToLocalDate(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Date() overflows "2026-13-40" into a later month; reject that.
  return toDateOnly(d) === value ? d : undefined;
}

/** Local Date → "YYYY-MM-DD". */
export function toDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface DateFieldProps {
  id?: string;
  /** Calendar day "YYYY-MM-DD" or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  /** Inclusive bounds, same "YYYY-MM-DD" transport. */
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
  /** False when nested in a Dialog so the calendar stays clickable. */
  modal?: boolean;
}

/**
 * Calendar-day field shaped like an `Input`: a trigger that shows the picked
 * day in the UI locale and opens a Popover + Calendar. The value stays a
 * "YYYY-MM-DD" string so callers keep the same wiring as `<input type="date">`.
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  modal = true,
}: DateFieldProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = dateOnlyToLocalDate(value);
  const before = min ? dateOnlyToLocalDate(min) : undefined;
  const after = max ? dateOnlyToLocalDate(max) : undefined;
  const label = selected
    ? selected.toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" })
    : t("common.date_pick");

  return (
    <Popover modal={modal} open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-2 pointer-coarse:min-h-11 rounded-lg border border-input bg-transparent px-2.5 py-1 text-left text-body transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          !selected && "text-muted-foreground",
          className,
        )}
      >
        <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <button
          type="button"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-body transition-colors hover:bg-accent"
        >
          <span className="flex-1 text-muted-foreground">{t("common.date_clear")}</span>
          <Check aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", selected && "invisible")} />
        </button>
        <Suspense fallback={<div className="h-72 w-64" aria-hidden />}>
          <Calendar
            mode="single"
            lang={i18n.language}
            selected={selected}
            defaultMonth={selected}
            disabled={[...(before ? [{ before }] : []), ...(after ? [{ after }] : [])]}
            onSelect={(d) => {
              onChange(d ? toDateOnly(d) : "");
              setOpen(false);
            }}
          />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
