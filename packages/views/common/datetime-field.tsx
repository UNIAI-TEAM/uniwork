"use client";

import { DateTimePicker } from "./date-time-picker";

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
  return (
    <DateTimePicker
      id={id}
      value={value}
      onChange={(next) => {
        const { date, time } = splitDateTimeLocal(next);
        onChange(joinDateTimeLocal(date, time));
      }}
      min={minDate}
      disabled={disabled}
      className={className}
      timeMode="required"
      hourLabel={hourLabel}
      minuteLabel={minuteLabel}
    />
  );
}
