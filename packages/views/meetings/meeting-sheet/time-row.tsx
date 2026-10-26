"use client";
import { useRef } from "react";
import { ChevronDown, CircleAlert, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { TimeInput } from "@uniwork/ui/components/ui/time-input";
import { cn } from "@uniwork/ui/lib/utils";
import { DateField } from "../../common/date-field";
import { durationWords, longDay } from "../meeting-detail/format";
import { TextButton } from "../meeting-detail/ui/text-button";
import { MEETING_TIMEZONES, scheduleWindowIso, splitIsoLocal } from "../meeting-datetime";
import { meetingTimeZoneLabel } from "../meeting-detail-format";
import { scheduleProblems } from "../meeting-schedule-fields";
import { durationMinutes, nextQuarterHour, plusMinutes } from "./draft-validation";
import { MENU_ITEM_LEFT_CHECK } from "./sheet-styles";

export type TimeValue = { date: string; start: string; end: string; timezone: string };

/** Phone (CreatePhone f1): both boxes carry the clock, digits sit left in 44px cells. */
const PHONE_TIME = "max-sm:justify-start max-sm:gap-0 max-sm:px-3 max-sm:[&>svg]:mr-0 max-sm:[&>svg]:size-4 max-sm:[&_input]:h-11 max-sm:[&_input]:w-11 max-sm:[&>span]:-mx-2.5";
/** Phone, edit and follow-up (EditScheduled at 390): the desktop boxes stretched to 44, digits centred. */
const SHEET_TIME =
  "max-sm:group-data-[phone-sheet]/sheet:justify-center max-sm:group-data-[phone-sheet]/sheet:gap-0.5 max-sm:group-data-[phone-sheet]/sheet:px-2 max-sm:group-data-[phone-sheet]/sheet:[&>svg]:mr-1.5 max-sm:group-data-[phone-sheet]/sheet:[&>svg]:size-3.5 max-sm:group-data-[phone-sheet]/sheet:[&_input]:h-auto max-sm:group-data-[phone-sheet]/sheet:[&_input]:w-[2.3ch] max-sm:group-data-[phone-sheet]/sheet:[&>span]:mx-0";

const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };

/** The zones offered: the seven, with the record's or browser's own first when none of them reads its clock. */
export function zoneChoices(current: string): string[] {
  const listed: readonly string[] = MEETING_TIMEZONES;
  return listed.includes(current) ? [...listed] : [current, ...listed];
}

/**
 * Thời gian (create brief §2.3): the day, start – end, then one caption with
 * the length and the zone menu. Moving the start keeps the length. A start
 * that passed shows once `revealPast` (the person left the field after a
 * change, or submitted), with "Dời sang 21:30"; an end equal to the start
 * shows at once; an end before the start is the next day, said in words.
 * The caption is a polite live region, so the new length is heard.
 */
export function TimeRow({
  idPrefix,
  value,
  onChange,
  nowMs,
  checkPast,
  revealPast,
  onCommit,
  readOnly = false,
  label = true,
  joinDot = false,
  className,
}: {
  idPrefix: string;
  value: TimeValue;
  onChange: (next: Partial<TimeValue>) => void;
  nowMs: number;
  /** Off for an edit whose time was not touched: a missed meeting keeps its past start. */
  checkPast: boolean;
  revealPast: boolean;
  /** Focus left the start/end/day after a change: the parent starts showing the past-start error. */
  onCommit?: () => void;
  readOnly?: boolean;
  /** The "Thời gian" label (the quick card draws its own line instead). */
  label?: boolean;
  /** The duration and its dot as one run of text (the edit sheet's board). */
  joinDot?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const changed = useRef(false);
  const { date, start, end, timezone } = value;
  const problems = scheduleProblems({ date, start, end, timeZone: timezone, nowMs, checkPast });
  const showPast = problems.startPassed && revealPast;
  const minutes = durationMinutes(start, end);
  const overnight = !problems.endInvalid && end < start;
  const zoneLabel = meetingTimeZoneLabel(timezone, i18n.language, new Date(nowMs));
  const errorId = `${idPrefix}-time-error`;
  const captionId = `${idPrefix}-time-caption`;

  const change = (next: Partial<TimeValue>) => {
    if (readOnly) return;
    changed.current = true;
    onChange(next);
  };
  const moveStart = (next: string) => change({ start: next, end: plusMinutes(next, minutes || 30) });
  const fixTime = splitIsoLocal(new Date(nextQuarterHour(nowMs)).toISOString(), timezone);
  const fix = () => {
    onChange({ date: fixTime.date, start: fixTime.time, end: plusMinutes(fixTime.time, minutes || 30) });
  };
  const endDay = overnight ? longDay(scheduleWindowIso(date, start, end, timezone).ends_at, nowMs, t, timezone) : "";

  return (
    <div
      className={className}
      onBlur={(e) => {
        if (changed.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          changed.current = false;
          onCommit?.();
        }
      }}
    >
      {label ? (
        <p id={`${idPrefix}-time-label`} className="mb-2 text-label font-medium text-foreground">
          {t("meetings.sheet.time")}
        </p>
      ) : null}
      <div className="flex items-center gap-2 max-sm:flex-wrap" aria-readonly={readOnly || undefined}>
        <DateField
          id={`${idPrefix}-date`}
          value={date}
          onChange={(d) => d && change({ date: d })}
          formatOptions={DAY_FORMAT}
          ariaLabel={t("meetings.sheet.dateAria", {
            date: new Date(`${date}T00:00:00`).toLocaleDateString(i18n.language, DAY_FORMAT),
          })}
          className="h-9 w-auto min-w-58 shrink-0 rounded-md bg-background text-body max-sm:h-11 max-sm:w-full"
        />
        <div
          id={`${idPrefix}-start`}
          className="max-sm:min-w-0 max-sm:flex-1"
          aria-invalid={showPast || undefined}
          aria-describedby={showPast ? errorId : undefined}
        >
          <TimeInput
            value={start}
            onChange={moveStart}
            hourLabel={t("meetings.startHour")}
            minuteLabel={t("meetings.startMinute")}
            className={cn(
              "h-9 w-24 justify-center gap-0.5 rounded-md bg-background px-2 font-mono font-medium dark:bg-background max-sm:h-11 max-sm:w-full [&_input]:w-[2.3ch] [&>svg]:mr-1.5",
              PHONE_TIME,
              SHEET_TIME,
              showPast && "border-destructive",
            )}
          />
        </div>
        <span aria-hidden className="text-muted-foreground max-sm:-mx-2 max-sm:w-4 max-sm:text-center max-sm:group-data-[phone-sheet]/sheet:mx-0 max-sm:group-data-[phone-sheet]/sheet:w-auto">
          –
        </span>
        <div
          id={`${idPrefix}-end`}
          className="max-sm:min-w-0 max-sm:flex-1"
          aria-invalid={problems.endInvalid || undefined}
          aria-describedby={problems.endInvalid ? errorId : overnight ? captionId : undefined}
        >
          <TimeInput
            value={end}
            onChange={(next) => change({ end: next })}
            hourLabel={t("meetings.endHour")}
            minuteLabel={t("meetings.endMinute")}
            className={cn(
              "h-9 w-24 justify-center gap-0.5 rounded-md bg-background px-2 font-mono font-medium dark:bg-background max-sm:h-11 max-sm:w-full [&_input]:w-[2.3ch] [&>svg]:hidden max-sm:[&>svg]:block",
              PHONE_TIME,
              SHEET_TIME,
              "max-sm:group-data-[phone-sheet]/sheet:[&>svg]:hidden",
              problems.endInvalid && "border-destructive",
            )}
          />
        </div>
      </div>
      <div aria-live="polite">
        {showPast || problems.endInvalid ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-caption text-destructive">
            <CircleAlert aria-hidden className="size-3.5 shrink-0" />
            <span id={errorId}>{t(showPast ? "meetings.startInPast" : "meetings.endSameAsStart")}</span>
            {showPast ? (
              <TextButton className="py-0" aria-label={t("meetings.sheet.moveStartAria", { time: fixTime.time })} onClick={fix}>
                {t("meetings.sheet.moveStart", { time: fixTime.time })}
              </TextButton>
            ) : null}
          </p>
        ) : null}
        <p id={captionId} className="mt-2 group-data-[mode=followUp]/sheet:mt-1.5 flex flex-wrap items-center gap-x-1 text-caption text-muted-foreground">
          {overnight ? (
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <Clock aria-hidden className="size-3" />
              {t("meetings.sheet.overnight", { time: end, day: endDay, duration: durationWords(minutes, t) })}
            </span>
          ) : null}
          {/* Edit draws "1 giờ ·" as one run of text (EditScheduled); create keeps the dot apart (CreateFull). */}
          {minutes > 0 && !overnight ? (
            // Joined, it is the caption's own text (EditScheduled: "1 giờ · " then the zone button).
            joinDot ? (
              `${durationWords(minutes, t)} ·`
            ) : (
              <span>{durationWords(minutes, t)}</span>
            )
          ) : null}
          {minutes > 0 && (overnight || !joinDot) ? <span aria-hidden>·</span> : null}
          <ZoneMenu value={timezone} label={zoneLabel} nowMs={nowMs} onChange={(tz) => change({ timezone: tz })} disabled={readOnly} />
        </p>
      </div>
    </div>
  );
}

function ZoneMenu({
  value,
  label,
  nowMs,
  onChange,
  disabled,
}: {
  value: string;
  label: string;
  nowMs: number;
  onChange: (tz: string) => void;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={t("meetings.sheet.zoneAria", { zone: label })}
        className="-mx-1 -my-0.5 inline-flex items-center gap-1 max-sm:group-data-[mode=edit]/sheet:min-h-11 rounded-xs px-1 py-0.5 text-caption text-muted-foreground hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-hover pointer-coarse:relative pointer-coarse:before:absolute pointer-coarse:before:-inset-x-1 pointer-coarse:before:-inset-y-3.5 pointer-coarse:before:content-['']"
      >
        {label}
        <ChevronDown aria-hidden className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-50">
        <DropdownMenuRadioGroup value={value} onValueChange={(v: string) => onChange(v)}>
          {zoneChoices(value).map((tz) => (
            <DropdownMenuRadioItem key={tz} value={tz} className={MENU_ITEM_LEFT_CHECK}>
              {meetingTimeZoneLabel(tz, i18n.language, new Date(nowMs))}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
