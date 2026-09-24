"use client";

import { CalendarClock, CalendarDays } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { DateTimePicker } from "../common/date-time-picker";
import { toDateOnly } from "../common/date-field";
import { PillButton } from "../common/pill-button";

export type TaskScheduleValue = {
  start_date?: string | null;
  due_date?: string | null;
  start_at?: string | null;
  due_at?: string | null;
};

type ScheduleKind = "start" | "due";

const ONE_HOUR_MS = 60 * 60 * 1000;

function localTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${toDateOnly(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function validInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function taskScheduleLocalValue(value: TaskScheduleValue, kind: ScheduleKind): string {
  const instant = validInstant(kind === "start" ? value.start_at : value.due_at);
  if (instant) return localTime(instant);
  return (kind === "start" ? value.start_date : value.due_date) ?? "";
}

function parseLocalValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function updateTaskSchedule(
  current: TaskScheduleValue,
  kind: ScheduleKind,
  nextLocal: string,
): TaskScheduleValue {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(nextLocal) ? nextLocal : undefined;
  const nextInstant = parseLocalValue(nextLocal);
  const next: TaskScheduleValue = {
    start_date: current.start_date ?? undefined,
    due_date: current.due_date ?? undefined,
    start_at: current.start_at ?? undefined,
    due_at: current.due_at ?? undefined,
  };

  if (!nextInstant) {
    if (kind === "start") next.start_date = dateOnly;
    else next.due_date = dateOnly;
    next.start_at = undefined;
    next.due_at = undefined;
    return next;
  }

  if (kind === "start") {
    const existingDue = validInstant(current.due_at);
    const due = existingDue && existingDue > nextInstant
      ? existingDue
      : new Date(nextInstant.getTime() + ONE_HOUR_MS);
    next.start_date = toDateOnly(nextInstant);
    next.due_date = toDateOnly(due);
    next.start_at = nextInstant.toISOString();
    next.due_at = due.toISOString();
  } else {
    const existingStart = validInstant(current.start_at);
    const start = existingStart && existingStart < nextInstant
      ? existingStart
      : new Date(nextInstant.getTime() - ONE_HOUR_MS);
    next.start_date = toDateOnly(start);
    next.due_date = toDateOnly(nextInstant);
    next.start_at = start.toISOString();
    next.due_at = nextInstant.toISOString();
  }
  return next;
}

export function TaskScheduleField({
  kind,
  label,
  value,
  onChange,
  compact = false,
  open,
  onOpenChange,
}: {
  kind: ScheduleKind;
  label: string;
  value: TaskScheduleValue;
  onChange: (value: TaskScheduleValue) => void;
  compact?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const Icon = kind === "start" ? CalendarClock : CalendarDays;
  const trigger = compact ? (<PillButton /> as ReactElement<Record<string, unknown>>) : undefined;

  return (
    <DateTimePicker
      value={taskScheduleLocalValue(value, kind)}
      onChange={(next) => onChange(updateTaskSchedule(value, kind, next))}
      timeMode="optional"
      ariaLabel={label}
      placeholder={label}
      hourLabel={`${label}: ${t("common.hour")}`}
      minuteLabel={`${label}: ${t("common.minute")}`}
      icon={<Icon className="size-3.5 shrink-0" aria-hidden="true" />}
      modal={!compact}
      formatOptions={compact ? { day: "numeric", month: "short" } : undefined}
      triggerRender={trigger}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}
