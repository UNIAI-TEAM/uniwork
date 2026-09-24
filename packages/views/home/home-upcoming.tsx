"use client";

import { ArrowRight, CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { localDay } from "@uniwork/core/home/brief";
import { paths } from "@uniwork/core/paths";
import type { Meeting } from "@uniwork/core/types";
import type { HomeSummary } from "@uniwork/core/types/home";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { PanelCard } from "../common/panel-card";
import { CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { formatMeetingDay, formatMeetingTimes, meetingLocale } from "../meetings/meeting-datetime";
import { AppLink } from "../navigation";
import { HomePartialNotice } from "./home-partial-notice";
import { HomeMeetingRowsSkeleton } from "./home-skeletons";
import { clock, minutesBetween } from "./home-time";

function nextDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString().slice(0, 10);
}

function useDuration(): (minutes: number) => string {
  const { t } = useTranslation();
  return (minutes) => {
    if (minutes < 60) return t("home.upcoming.minutes", { count: minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? t("home.upcoming.hours", { count: hours }) : t("home.upcoming.hours_minutes", { hours, minutes: rest });
  };
}

function MeetingRow({ meeting, href, roomHref, timeZone }: { meeting: Meeting; href: string; roomHref: string; timeZone?: string }) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const duration = useDuration();
  const live = meeting.status === "IN_PROGRESS";
  const minutes = minutesBetween(meeting.starts_at, meeting.ends_at);

  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-surface-hover focus-within:bg-surface-selected">
      {/* The time column is for the eye; the link below carries the same span as text. */}
      <span aria-hidden className="flex w-11 shrink-0 flex-col text-right tabular-nums">
        <span className="text-body font-semibold text-foreground">{clock(meeting.starts_at, locale, timeZone)}</span>
        <span className="text-caption text-muted-foreground">{clock(meeting.ends_at, locale, timeZone)}</span>
      </span>
      <span aria-hidden className={cn("w-0.5 self-stretch rounded-full", live ? "bg-success" : "bg-tint-violet-solid")} />
      <AppLink href={href} className="min-w-0 flex-1 rounded-sm">
        <span className="line-clamp-2 text-body font-medium text-pretty text-foreground">{meeting.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
          {live ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-success">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              {t("home.upcoming.live")}
            </span>
          ) : null}
          {minutes > 0 ? <span aria-hidden>{duration(minutes)}</span> : null}
          <span className="sr-only">{formatMeetingTimes(meeting.starts_at, meeting.ends_at, locale, timeZone || undefined)}</span>
        </span>
      </AppLink>
      {live ? (
        <AppLink href={roomHref} className={cn(buttonVariants({ size: "sm" }))}>
          {t("home.upcoming.join")}
        </AppLink>
      ) : null}
    </li>
  );
}

/**
 * Meetings in progress, today and tomorrow that the viewer is part of, under
 * a heading per day. The server sends them by start time, so a day's meetings
 * are already consecutive.
 */
export function HomeUpcoming({
  summary,
  loading,
  retrying,
  onRetry,
}: {
  summary: HomeSummary | undefined;
  loading: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const meetings = summary?.upcoming_meetings ?? [];
  const locale = meetingLocale(i18n.language);
  const failed = summary?.partial.includes("meetings") ?? false;

  const days: { key: string; label: string; meetings: Meeting[] }[] = [];
  if (summary) {
    for (const meeting of meetings) {
      const day = localDay(meeting.starts_at, summary.timezone || "UTC");
      const last = days[days.length - 1];
      if (last && last.key === day) {
        last.meetings.push(meeting);
        continue;
      }
      const label =
        day === summary.today
          ? t("home.upcoming.today")
          : day === nextDay(summary.today)
            ? t("home.upcoming.tomorrow")
            : formatMeetingDay(day, locale);
      days.push({ key: day, label, meetings: [meeting] });
    }
  }

  return (
    <PanelCard
      id="home-upcoming"
      title={t("home.section.upcoming")}
      icon={CalendarDays}
      iconTone={moduleTone("meetings")}
      flush
      className="shadow-none"
      action={
        <AppLink href={ws.meetings()} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          {t("home.upcoming.view_all")}
          <ArrowRight aria-hidden data-icon="inline-end" />
        </AppLink>
      }
    >
      {failed ? <HomePartialNotice source="meetings" onRetry={onRetry} retrying={retrying} /> : null}
      {loading ? (
        <HomeMeetingRowsSkeleton />
      ) : failed && meetings.length === 0 ? null : !summary || meetings.length === 0 ? (
        <CollectionPageState
          className="py-6"
          icon={CalendarDays}
          tone={moduleTone("meetings")}
          title={t("home.upcoming.empty_title")}
          description={t("home.upcoming.empty_description")}
          actions={
            <AppLink href={ws.meetings()} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("home.upcoming.empty_action")}
            </AppLink>
          }
        />
      ) : (
        <div className="py-1">
          {days.map((day) => (
            <div key={day.key}>
              <h3 className="px-4 pt-3 pb-1 text-caption font-medium text-muted-foreground first-letter:uppercase">{day.label}</h3>
              <ul aria-label={day.label}>
                {day.meetings.map((meeting) => (
                  <MeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    href={ws.meeting(meeting.id)}
                    roomHref={ws.room(meeting.id)}
                    timeZone={summary?.timezone}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}
