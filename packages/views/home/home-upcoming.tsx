"use client";

import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { localDay } from "@uniwork/core/home/brief";
import { paths } from "@uniwork/core/paths";
import type { Meeting } from "@uniwork/core/types";
import type { HomeSummary } from "@uniwork/core/types/home";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { PanelCard } from "../common/panel-card";
import { CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { formatMeetingDay, formatMeetingTimes, meetingLocale } from "../meetings/meeting-datetime";
import { AppLink } from "../navigation";
import { HomePartialNotice } from "./home-partial-notice";

function nextDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)).toISOString().slice(0, 10);
}

function MeetingRow({ meeting, summary, href, roomHref }: { meeting: Meeting; summary: HomeSummary; href: string; roomHref: string }) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const live = meeting.status === "IN_PROGRESS";
  const day = localDay(meeting.starts_at, summary.timezone || "UTC");
  const dayLabel =
    day === summary.today ? t("home.upcoming.today") : day === nextDay(summary.today) ? t("home.upcoming.tomorrow") : formatMeetingDay(day, locale);

  return (
    <li className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
      <IconTile icon={CalendarDays} size="sm" tone={moduleTone("meetings")} />
      <AppLink href={href} className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-foreground">{meeting.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
          {live ? <span className="font-medium text-success">{t("home.upcoming.live")}</span> : <span>{dayLabel}</span>}
          <span className="tabular-nums">{formatMeetingTimes(meeting.starts_at, meeting.ends_at, locale)}</span>
        </span>
      </AppLink>
      {live ? (
        <AppLink href={roomHref} className={buttonVariants({ size: "sm" })}>
          {t("home.upcoming.join")}
        </AppLink>
      ) : (
        <AppLink href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("home.upcoming.open")}
        </AppLink>
      )}
    </li>
  );
}

/** Meetings in progress, today and tomorrow that the viewer is part of. */
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
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const meetings = summary?.upcoming_meetings ?? [];

  return (
    <PanelCard
      id="home-upcoming"
      title={t("home.section.upcoming")}
      icon={CalendarDays}
      flush
      className="h-full"
      action={
        <AppLink href={ws.meetings()} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t("home.upcoming.view_all")}
        </AppLink>
      }
    >
      {summary?.partial.includes("meetings") ? <HomePartialNotice source="meetings" onRetry={onRetry} retrying={retrying} /> : null}
      {loading ? (
        <div className="space-y-2 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !summary || meetings.length === 0 ? (
        <CollectionPageState
          className="py-8"
          icon={CalendarDays}
          tone={moduleTone("meetings")}
          title={t("home.upcoming.empty_title")}
          description={t("home.upcoming.empty_description")}
          actions={
            <AppLink href={ws.meetings()} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("home.upcoming.empty_action")}
            </AppLink>
          }
        />
      ) : (
        <ul>
          {meetings.map((meeting) => (
            <MeetingRow
              key={meeting.id}
              meeting={meeting}
              summary={summary}
              href={ws.meeting(meeting.id)}
              roomHref={ws.room(meeting.id)}
            />
          ))}
        </ul>
      )}
    </PanelCard>
  );
}
