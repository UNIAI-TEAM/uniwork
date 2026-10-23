"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField, dateOnlyToLocalDate, toDateOnly } from "./date-field";

/** Short "29 thg 9" in the current year; the year appears only when it differs. */
export function shortDateFormat(value: string | null | undefined): Intl.DateTimeFormatOptions {
  const sameYear = value?.slice(0, 4) === String(new Date().getFullYear());
  return sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
}

/** Compact inline date trigger for detail sidebars: icon, short date, red when overdue. */
export function DatePill({
  value,
  label,
  icon,
  min,
  max,
  highlightOverdue = false,
  open,
  onOpenChange,
  onChange,
  disabled = false,
}: {
  value: string | null;
  label: string;
  icon: ReactNode;
  min?: string;
  max?: string;
  highlightOverdue?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const overdue = highlightOverdue && !!value && value < toDateOnly(new Date());
  const selected = dateOnlyToLocalDate(value ?? "");
  const shown = selected?.toLocaleDateString(i18n.language, shortDateFormat(value));
  return (
    <DateField
      value={value ?? ""}
      min={min}
      max={max}
      placeholder={label}
      ariaLabel={`${label}: ${shown ?? t("common.date_pick")}`}
      formatOptions={shortDateFormat(value)}
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
      triggerRender={
        <button
          type="button"
          className="-mx-1 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-caption transition-colors hover:bg-accent/30 disabled:cursor-default disabled:hover:bg-transparent"
        />
      }
      renderTrigger={(text, isSelected) => (
        <>
          {icon}
          <span
            className={cn(
              "truncate",
              !isSelected && "text-muted-foreground",
              overdue && "text-destructive",
            )}
          >
            {text}
          </span>
        </>
      )}
      onChange={(next) => onChange(next === "" ? null : next)}
    />
  );
}
