"use client";

import { useState } from "react";
import { TimeInput } from "@uniwork/ui/components/ui/time-input";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "./date-field";

const DEFAULT_TIME = "09:00";

/** Split "YYYY-MM-DDTHH:mm" into its two halves; anything else reads as empty. */
export function splitDateTimeLocal(value: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value.trim());
  if (!m) return { date: "", time: "" };
  return { date: m[1] as string, time: m[2] as string };
}

/** Join the two halves back into the transport, or "" while the day is unset. */
export function joinDateTimeLocal(date: string, time: string): string {
  if (!date) return "";
  return `${date}T${time || DEFAULT_TIME}`;
}

interface DateTimeFieldProps {
  id?: string;
  /** "YYYY-MM-DDTHH:mm" or "" when unset — the `datetime-local` transport. */
  value: string;
  onChange: (value: string) => void;
  /** Inclusive earliest day, "YYYY-MM-DD". */
  minDate?: string;
  disabled?: boolean;
  className?: string;
  /** Accessible names for the hour and minute segments. */
  hourLabel: string;
  minuteLabel: string;
}

/**
 * A day and a time of day, side by side, over the same string a
 * `datetime-local` input would carry. Picking a day with no time yet fills in
 * 09:00 rather than emitting a half-written value the caller cannot parse;
 * clearing the day clears the whole field. A time set before any day is held
 * here until a day is picked — it never invents "today" on its own.
 */
export function DateTimeField({
  id,
  value,
  onChange,
  minDate,
  disabled,
  className,
  hourLabel,
  minuteLabel,
}: DateTimeFieldProps) {
  const { date, time } = splitDateTimeLocal(value);
  // The time of day typed while the day is still empty; the value cannot carry it yet.
  const [pendingTime, setPendingTime] = useState("");
  const shownTime = time || pendingTime || DEFAULT_TIME;
  return (
    <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", className)}>
      <DateField
        id={id}
        value={date}
        min={minDate}
        disabled={disabled}
        onChange={(next) => {
          // Clearing the day keeps the time shown, so picking a day again restores it.
          if (!next && time) setPendingTime(time);
          onChange(joinDateTimeLocal(next, time || pendingTime));
        }}
      />
      <TimeInput
        className="w-full max-w-full"
        value={shownTime}
        disabled={disabled}
        hourLabel={hourLabel}
        minuteLabel={minuteLabel}
        onChange={(next) => {
          if (date) onChange(joinDateTimeLocal(date, next));
          else setPendingTime(next);
        }}
      />
    </div>
  );
}
