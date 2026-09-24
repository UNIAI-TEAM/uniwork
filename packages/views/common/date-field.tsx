"use client";

import { DateTimePicker, type DateTimePickerProps } from "./date-time-picker";

export { dateOnlyToLocalDate, toDateOnly } from "./date-time-picker";

export type DateFieldProps = Omit<DateTimePickerProps, "timeMode" | "hourLabel" | "minuteLabel">;

/**
 * Calendar-day field shaped like an `Input`: a trigger that shows the picked
 * day in the UI locale and opens a Popover + Calendar. The value stays a
 * "YYYY-MM-DD" string so callers keep the same wiring as `<input type="date">`.
 */
export function DateField(props: DateFieldProps) {
  return <DateTimePicker {...props} timeMode="hidden" />;
}
