"use client";
import { CalendarDays, Clock, Play, TriangleAlert, UserRound, Users, Video, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { AvatarGroup, AvatarGroupCount } from "@uniwork/ui/components/ui/avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import {
  formatMeetingDay,
  formatMeetingTimes,
  formatRelativeTime,
  meetingDayKey,
  meetingDurationParts,
  meetingLocale,
} from "./meeting-datetime";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingRsvpBar } from "./meeting-rsvp-bar";
import { MeetingStatusBadge } from "./meeting-status-badge";
import { MeetingCalendarButton } from "./meeting-summary-panel";

const AVATAR_STACK_LIMIT = 4;

function MetaItem({ icon: Icon, children, className }: { icon: typeof Clock; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-body text-muted-foreground", className)}>
      <Icon aria-hidden className="size-4 shrink-0 text-faint-foreground" />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/**
 * The first thing on the detail page: status and when, the title, the facts
 * that decide whether to show up (day, time, host, who else), and the one
 * action that matters right now.
 */
export function MeetingDetailHero({
  meeting,
  hostName,
  participants,
  myInvite,
  canHost,
  canEnter,
  pendingJoins,
  startPending,
  onStart,
  onJoin,
}: {
  meeting: Meeting;
  hostName: string;
  participants: MeetingParticipant[];
  myInvite?: MeetingInvitation;
  canHost: boolean;
  canEnter: boolean;
  pendingJoins: number;
  startPending: boolean;
  onStart: () => void;
  onJoin: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const scheduled = meeting.status === "SCHEDULED" || !meeting.status;
  const inProgress = meeting.status === "IN_PROGRESS";
  const ended = meeting.status === "ENDED";
  const canceled = meeting.status === "CANCELED";
  const closed = ended || canceled;

  const duration = meetingDurationParts(meeting.starts_at, meeting.ends_at);
  const durationLabel = duration
    ? [
        duration.hours > 0 ? t("meetings.durationHours", { count: duration.hours }) : null,
        duration.minutes > 0 || duration.hours === 0 ? t("meetings.durationMinutes", { count: duration.minutes }) : null,
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const relative = scheduled
    ? t("meetings.startsRelative", { when: formatRelativeTime(meeting.starts_at, locale) })
    : inProgress
      ? t("meetings.startedRelative", { when: formatRelativeTime(meeting.actual_start_at ?? meeting.starts_at, locale) })
      : ended
        ? t("meetings.endedRelative", { when: formatRelativeTime(meeting.actual_end_at ?? meeting.ends_at, locale) })
        : null;

  const shownPeople = participants.slice(0, AVATAR_STACK_LIMIT);
  const morePeople = participants.length - shownPeople.length;
  const joinLabel = canHost && pendingJoins > 0 ? `${t("meetings.join")} (${pendingJoins})` : t("meetings.join");

  return (
    <section
      aria-label={meeting.title}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-surface shadow-[var(--surface-shadow)]",
        inProgress ? "border-brand/30" : "border-surface-border",
        canceled && "opacity-90",
      )}
    >
      {inProgress ? (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-brand/10 to-transparent" />
      ) : null}
      <div className="relative p-5 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <MeetingStatusBadge status={meeting.status} />
          {meeting.meeting_type === "INSTANT" ? (
            <Badge variant="outline">
              <Zap aria-hidden />
              {t("meetings.typeInstant")}
            </Badge>
          ) : null}
          {relative ? <span className="text-label text-muted-foreground">{relative}</span> : null}
        </div>

        <h1
          className={cn(
            "mt-3 max-w-4xl text-balance text-display-sm font-semibold tracking-tight text-foreground",
            canceled && "line-through decoration-faint-foreground/60",
          )}
        >
          {meeting.title}
        </h1>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <MetaItem icon={CalendarDays}>{formatMeetingDay(meetingDayKey(meeting.starts_at), locale)}</MetaItem>
          <MetaItem icon={Clock}>
            <span className="tabular-nums">{formatMeetingTimes(meeting.starts_at, meeting.ends_at, locale)}</span>
            {durationLabel ? <span className="text-faint-foreground"> · {durationLabel}</span> : null}
          </MetaItem>
          <div className="flex min-w-0 items-center gap-2 text-body text-muted-foreground">
            <UserRound aria-hidden className="size-4 shrink-0 text-faint-foreground" />
            <MeetingPersonAvatar name={hostName} size="sm" />
            <span className="min-w-0 truncate">
              <span className="font-medium text-foreground">{hostName}</span>
              <span className="text-faint-foreground"> · {t("meetings.host")}</span>
            </span>
          </div>
          {participants.length > 0 ? (
            <div className="flex min-w-0 items-center gap-2 text-body text-muted-foreground">
              <Users aria-hidden className="size-4 shrink-0 text-faint-foreground" />
              <AvatarGroup>
                {shownPeople.map((p) => (
                  <MeetingPersonAvatar key={p.id} name={p.display_name_snapshot || p.user_id || "?"} size="sm" />
                ))}
                {morePeople > 0 ? (
                  <AvatarGroupCount className="size-6 text-caption">{t("meetings.moreParticipantsShort", { count: morePeople })}</AvatarGroupCount>
                ) : null}
              </AvatarGroup>
              <span className="tabular-nums">{t("meetings.participantCount", { count: participants.length })}</span>
            </div>
          ) : null}
        </div>

        {meeting.description ? (
          <p className="mt-5 max-w-3xl whitespace-pre-wrap break-words text-pretty text-body-lg leading-relaxed text-muted-foreground">
            {meeting.description}
          </p>
        ) : null}

        {!canEnter && !closed ? (
          <p role="status" className="mt-5 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 text-body text-foreground dark:bg-warning/10">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            {t("meetings.pastScheduledEndHint")}
          </p>
        ) : null}

        {canceled ? null : (
          <div className="mt-6 flex flex-col gap-4 border-t border-border pt-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {canHost && scheduled && canEnter ? (
                <Button type="button" size="lg" variant="outline" disabled={startPending} onClick={onStart}>
                  <Play aria-hidden />
                  {t("meetings.start")}
                </Button>
              ) : null}
              {closed || !canEnter ? null : (
                <Button type="button" size="lg" variant="brand" className="px-4 shadow-[var(--surface-shadow)]" onClick={onJoin}>
                  <Video aria-hidden />
                  {joinLabel}
                </Button>
              )}
              <MeetingCalendarButton meetingId={meeting.id} className="text-muted-foreground" />
            </div>
            {myInvite && !closed ? <MeetingRsvpBar meetingId={meeting.id} invitation={myInvite} /> : null}
          </div>
        )}
      </div>
    </section>
  );
}
