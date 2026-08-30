"use client";
import { useTranslation } from "react-i18next";
import { Field, FieldError, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { TimeInput } from "@uniwork/ui/components/ui/time-input";
import { meetingDayKey } from "./meeting-datetime";

/** "HH:MM" strings compare as times; the window is valid only when it has length. */
export function scheduleValid(start: string, end: string): boolean {
  return end > start;
}

function plusMinutes(hhmm: string, minutes: number): string {
  const [h = 0, m = 0] = hhmm
    .split(":")
    .map((x) => Number.parseInt(x, 10) || 0);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
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
 * is inline: the end hour cannot be arrowed before the start, and a typed
 * end at or before the start shows an error on the field itself.
 */
export function MeetingScheduleFields({
  idPrefix,
  date,
  start,
  end,
  onDate,
  onStart,
  onEnd,
}: {
  idPrefix: string;
  date: string;
  start: string;
  end: string;
  onDate: (v: string) => void;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
}) {
  const { t } = useTranslation();
  const invalid = !scheduleValid(start, end);
  const startHour = Number.parseInt(start.slice(0, 2), 10) || 0;
  // Moving the start past the end would leave the end field clamped on screen
  // but stale in state; carry the end along instead, keeping a 30-minute window.
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
        <Input
          id={`${idPrefix}-date`}
          type="date"
          min={meetingDayKey(new Date().toISOString())}
          value={date}
          onChange={(e) => onDate(e.target.value)}
          required
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>{t("meetings.startsAt")}</FieldLabel>
          <TimeInput
            value={start}
            onChange={moveStart}
            hourLabel={t("meetings.startHour")}
            minuteLabel={t("meetings.startMinute")}
          />
        </Field>
        <Field data-invalid={invalid || undefined}>
          <FieldLabel>{t("meetings.endsAt")}</FieldLabel>
          <TimeInput
            value={end}
            onChange={onEnd}
            hourMin={startHour}
            hourLabel={t("meetings.endHour")}
            minuteLabel={t("meetings.endMinute")}
          />
          {invalid ? (
            <FieldError>{t("meetings.endBeforeStart")}</FieldError>
          ) : null}
        </Field>
      </div>
    </>
  );
}
