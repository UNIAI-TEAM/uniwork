"use client";
import { useTranslation } from "react-i18next";
import { Field, FieldDescription, FieldError, FieldLabel } from "@uniwork/ui/components/ui/field";
import { TimeInput } from "@uniwork/ui/components/ui/time-input";
import { DateField } from "../common/date-field";
import { scheduleWindowIso, splitIsoLocal } from "./meeting-datetime";
import { useNow } from "./use-now";

/**
 * "HH:MM" strings compare as times. An end before the start runs into the
 * next day (see `scheduleWindowIso`), so only a window with no length is
 * invalid.
 */
export function scheduleValid(start: string, end: string): boolean {
  return /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && end !== start;
}

export type ScheduleProblems = { startPassed: boolean; endInvalid: boolean };

/**
 * What is wrong with a typed window. `checkPast` is off for a meeting whose
 * start the viewer has not touched: rescheduling a missed meeting's title
 * must not be blocked by the start it already had.
 */
export function scheduleProblems({
  date,
  start,
  end,
  timeZone,
  nowMs,
  checkPast = true,
}: {
  date: string;
  start: string;
  end: string;
  timeZone?: string;
  nowMs: number;
  checkPast?: boolean;
}): ScheduleProblems {
  const endInvalid = !scheduleValid(start, end);
  const startPassed =
    checkPast && Boolean(date) && /^\d{2}:\d{2}$/.test(start)
      ? Date.parse(scheduleWindowIso(date, start, end, timeZone).starts_at) < nowMs
      : false;
  return { startPassed, endInvalid };
}

/** True when the form may be sent. */
export function scheduleReady(date: string, problems: ScheduleProblems): boolean {
  return Boolean(date) && !problems.startPassed && !problems.endInvalid;
}

/** Moves focus to the first schedule field that needs fixing. */
export function focusScheduleProblem(idPrefix: string, problems: ScheduleProblems): void {
  const target = problems.startPassed ? `${idPrefix}-start` : problems.endInvalid ? `${idPrefix}-end` : null;
  if (!target) return;
  document.getElementById(target)?.querySelector<HTMLInputElement>("input")?.focus();
}

function plusMinutes(hhmm: string, minutes: number): string {
  const [h = 0, m = 0] = hhmm
    .split(":")
    .map((x) => Number.parseInt(x, 10) || 0);
  // Wraps past midnight: the end then reads as the next day, never a sliver
  // clamped to 23:59.
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The viewer's zone: times are typed and shown in it, so it is what the record carries. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Date + start/end window shared by the create and edit dialogs. Validation
 * is inline and tied to the field it is about: a start that already passed,
 * an end equal to the start. An end earlier than the start is the next day,
 * and says so.
 */
export function MeetingScheduleFields({
  idPrefix,
  date,
  start,
  end,
  onDate,
  onStart,
  onEnd,
  minDate,
  timeZone,
  checkPast = true,
}: {
  /** Unique per form (useId): the date input and the two time labels hang off it. */
  idPrefix: string;
  date: string;
  start: string;
  end: string;
  onDate: (v: string) => void;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  /** Earliest pickable day; null for no floor (editing a meeting already dated). */
  minDate?: string | null;
  /** IANA zone the times are typed in; the browser's when omitted. */
  timeZone?: string;
  /** Flag a start that already passed (off while editing an untouched start). */
  checkPast?: boolean;
}) {
  const { t } = useTranslation();
  const nowMs = useNow();
  const floor = minDate === undefined ? splitIsoLocal(new Date(nowMs).toISOString(), timeZone).date : minDate;
  const problems = scheduleProblems({ date, start, end, timeZone, nowMs, checkPast });
  const overnight = !problems.endInvalid && end < start;
  const startErrorId = `${idPrefix}-start-error`;
  const endHintId = `${idPrefix}-end-hint`;
  // Moving the start onto the end would leave a window with no length; carry
  // the end along instead, keeping a 30-minute window.
  const moveStart = (next: string) => {
    onStart(next);
    if (!scheduleValid(next, end)) onEnd(plusMinutes(next, 30));
  };
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-date`}>
          {t("meetings.date")}
        </FieldLabel>
        <DateField
          id={`${idPrefix}-date`}
          min={floor ?? undefined}
          value={date}
          onChange={onDate}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          id={`${idPrefix}-start`}
          className="min-w-0"
          aria-labelledby={`${idPrefix}-start-label`}
          aria-describedby={problems.startPassed ? startErrorId : undefined}
          aria-invalid={problems.startPassed || undefined}
          data-invalid={problems.startPassed || undefined}
        >
          <FieldLabel id={`${idPrefix}-start-label`}>{t("meetings.startsAt")}</FieldLabel>
          <TimeInput
            className="w-full max-w-full"
            value={start}
            onChange={moveStart}
            hourLabel={t("meetings.startHour")}
            minuteLabel={t("meetings.startMinute")}
          />
          {problems.startPassed ? <FieldError id={startErrorId}>{t("meetings.startInPast")}</FieldError> : null}
        </Field>
        <Field
          id={`${idPrefix}-end`}
          className="min-w-0"
          aria-labelledby={`${idPrefix}-end-label`}
          aria-describedby={problems.endInvalid || overnight ? endHintId : undefined}
          aria-invalid={problems.endInvalid || undefined}
          data-invalid={problems.endInvalid || undefined}
        >
          <FieldLabel id={`${idPrefix}-end-label`}>{t("meetings.endsAt")}</FieldLabel>
          <TimeInput
            className="w-full max-w-full"
            value={end}
            onChange={onEnd}
            hourLabel={t("meetings.endHour")}
            minuteLabel={t("meetings.endMinute")}
          />
          {problems.endInvalid ? (
            <FieldError id={endHintId}>{t("meetings.endSameAsStart")}</FieldError>
          ) : overnight ? (
            <FieldDescription id={endHintId}>{t("meetings.endsNextDay")}</FieldDescription>
          ) : null}
        </Field>
      </div>
    </>
  );
}
