"use client";
import { Calendar, Clock, Ellipsis, Globe } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingShownWindow, sameUtcOffset, splitIsoLocal } from "../meeting-datetime";
import { meetingTimeZoneLabel } from "../meeting-detail-format";
import { browserTimeZone } from "../meeting-schedule-fields";
import type { DetailStatus } from "./detail-model";
import { clockRange, dayWord, durationWords, elapsedWords, longDay, overtimeWords, untilWords } from "./format";
import { LiveTimeBar } from "./live-time-bar";
import { kitButton } from "./ui/kit-buttons";
import { MeetingStatusPill } from "./ui/status-pill";

const MINUTE = 60_000;

/** Times read as the clocks on screen: "20:54 → 21:18" is 24 minutes, whatever the seconds. */
const toMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;
const isoToMinute = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(toMinute(ms)).toISOString() : iso;
};

export type DetailMenuItem = { key: string; label: string; onSelect: () => void; destructive?: boolean };

/** ⋯ (kit `.more` menu): the page's rare actions, by role. Nothing to offer, no button. */
export function DetailMenu({ items, className }: { items: DetailMenuItem[]; className?: string }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const label = t("meetings.detail.header.more", { actions: items.map((i) => i.label.toLocaleLowerCase()).join(", ") });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="icon-lg" className={cn(kitButton.ghost, className)} aria-label={label}>
            <Ellipsis aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-50">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            variant={item.destructive ? "destructive" : "default"}
            className="h-9 gap-2 px-2.5"
            onClick={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "· còn 17 giờ", "· đã họp 1 giờ 24 phút", "· 28 phút": what the clock line ends with, per state. */
function clockTail(meeting: Meeting, status: DetailStatus, shown: { startsAt: string; endsAt: string }, now: number, t: ReturnType<typeof useTranslation>["t"]) {
  const started = meeting.actual_start_at ?? meeting.starts_at;
  switch (status) {
    case "SCHEDULED":
      return untilWords(meeting.starts_at, now, t) || durationWords((Date.parse(shown.endsAt) - Date.parse(shown.startsAt)) / MINUTE, t);
    case "IN_PROGRESS":
      return untilWords(meeting.ends_at, now, t);
    case "OVERTIME":
      return elapsedWords(started, now, t, { held: true });
    default: {
      const minutes = (Date.parse(shown.endsAt) - Date.parse(shown.startsAt)) / MINUTE;
      return Number.isFinite(minutes) ? durationWords(minutes, t) : "";
    }
  }
}

/**
 * The page header (kit `.ph`): the title, then one meta line — status pill (live and overtime carry their minutes), the
 * day ("· hôm qua" for yesterday), the clock range with its tail, and the
 * meeting's own clock when it was set in another zone. Live adds the time bar.
 */
export function DetailHeader({
  meeting: source,
  status,
  now: nowMs,
  menu,
}: {
  meeting: Meeting;
  status: DetailStatus;
  now: number;
  menu?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const now = toMinute(nowMs);
  const meeting = {
    ...source,
    starts_at: isoToMinute(source.starts_at),
    ends_at: isoToMinute(source.ends_at),
    actual_start_at: source.actual_start_at ? isoToMinute(source.actual_start_at) : undefined,
    actual_end_at: source.actual_end_at ? isoToMinute(source.actual_end_at) : undefined,
  };
  const ended = status === "ENDED";
  const shown = meetingShownWindow(meeting, ended);
  const started = meeting.actual_start_at ?? meeting.starts_at;
  const pillTime =
    status === "IN_PROGRESS" ? elapsedWords(started, now, t) : status === "OVERTIME" ? overtimeWords(meeting.ends_at, now, t) : undefined;
  const yesterday = dayWord(shown.startsAt, now, t) === t("meetings.detail.format.yesterday");

  const viewerZone = browserTimeZone();
  const meetingZone = meeting.timezone?.trim() || "";
  const otherZone = meetingZone !== "" && !sameUtcOffset(meetingZone, viewerZone, Date.parse(shown.startsAt));
  const range = (zone?: string) => {
    const r = clockRange(shown.startsAt, shown.endsAt, zone);
    const nextDay = splitIsoLocal(shown.endsAt, zone).date > splitIsoLocal(shown.startsAt, zone).date;
    return nextDay ? t("meetings.timesNextDay", { times: r }) : r;
  };
  const at = new Date(Date.parse(shown.startsAt));
  const times = otherZone ? t("meetings.timesInZone", { times: range(), zone: meetingTimeZoneLabel(viewerZone, i18n.language, at) }) : range();
  const tail = clockTail(meeting, status, shown, now, t);
  const live = status === "IN_PROGRESS" || status === "OVERTIME";

  return (
    <header>
      <div className="flex items-start justify-between gap-4">
        <h1 className="max-w-170 min-w-0 text-display-sm font-bold break-words [overflow-wrap:anywhere] @max-[37.5rem]/meeting:text-title-lg">
          {meeting.title}
        </h1>
        {menu ? <div className="-mt-0.75 flex flex-none gap-2">{menu}</div> : null}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-muted-foreground *:inline-flex *:items-center *:gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0 @max-[37.5rem]/meeting:gap-x-3 @max-[37.5rem]/meeting:gap-y-1.5 @max-[37.5rem]/meeting:text-caption">
        <MeetingStatusPill status={status} minutes={pillTime || undefined} />
        <span>
          <Calendar aria-hidden />
          {yesterday
            ? t("meetings.detail.header.dayWithWord", { day: longDay(shown.startsAt, now, t), word: t("meetings.detail.format.yesterday") })
            : longDay(shown.startsAt, now, t)}
        </span>
        <span className="tabular-nums @max-[37.5rem]/meeting:basis-full">
          <Clock aria-hidden />
          {/* The clock range is its own <time>, the tail a plain run after it (kit `<span><time>…</time> · 45 phút</span>`). */}
          <span>
            {tail ? (
              <Trans t={t} i18nKey="meetings.detail.header.clockWithTail" values={{ times, tail }} components={{ t: <time /> }} />
            ) : (
              <time>{times}</time>
            )}
          </span>
        </span>
        {otherZone ? (
          <span className="tabular-nums">
            <Globe aria-hidden />
            {t("meetings.timesInZone", { times: range(meetingZone), zone: meetingTimeZoneLabel(meetingZone, i18n.language, at) })}
          </span>
        ) : null}
      </div>
      {ended && meeting.scribe_enabled === false ? (
        <p className="mt-2 text-caption text-muted-foreground">{t("meetings.detail.header.scribeOff")}</p>
      ) : null}
      {live ? <LiveTimeBar startIso={started} endIso={meeting.ends_at} now={now} /> : null}
    </header>
  );
}
