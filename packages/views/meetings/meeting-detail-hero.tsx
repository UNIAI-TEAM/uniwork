"use client";
import { Ban, CalendarClock, CalendarDays, CalendarX2, Clock, Hourglass, PhoneOff, Play, Users, Video, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { displayMeetingStatus } from "@uniwork/core/meetings";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { AvatarGroup, AvatarGroupCount } from "@uniwork/ui/components/ui/avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { Notice } from "../common/notice";
import { MeetingCalendarButton } from "./meeting-calendar-button";
import { formatMeetingDay, formatMeetingStart, formatMeetingTimes, meetingDayKey, meetingLocale } from "./meeting-datetime";
import { MeetingEditDialog } from "./meeting-edit-dialog";
import { MeetingPersonAvatar } from "./meeting-person";
import { formatRelativeTime, meetingDurationParts } from "./meeting-relative-time";
import { MeetingRsvpBar } from "./meeting-rsvp-bar";
import { MeetingStatusBadge } from "./meeting-status-badge";

const AVATAR_STACK_LIMIT = 4;

type HeroPerson = { id: string; name: string; avatarUrl?: unknown };

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
 * action that matters right now. A window that passed gets its own notice
 * with what can still be done — the server refuses joins past `ends_at`, the
 * host can extend a live meeting or reschedule one that never started.
 */
export function MeetingDetailHero({
  workspaceId,
  meeting,
  host,
  people,
  myInvite,
  canHost,
  canCancel,
  pendingJoins,
  canceledAt,
  startPending,
  extendPending,
  onStart,
  onJoin,
  onExtend,
  onEnd,
  onCancel,
}: {
  workspaceId: string;
  meeting: Meeting;
  host: { name: string; avatarUrl?: unknown };
  people: HeroPerson[];
  myInvite?: MeetingInvitation;
  canHost: boolean;
  canCancel: boolean;
  pendingJoins: number;
  /** When the meeting was cancelled, from the activity log, if known. */
  canceledAt?: string;
  startPending: boolean;
  extendPending: boolean;
  onStart: () => void;
  onJoin: () => void;
  onExtend: () => void;
  onEnd: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const status = displayMeetingStatus(meeting);
  const scheduled = status === "SCHEDULED";
  const live = status === "IN_PROGRESS";
  const overtime = status === "OVERTIME";
  const missed = status === "MISSED";
  const ended = status === "ENDED";
  const canceled = status === "CANCELED";
  const open = scheduled || live;

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
    : live || overtime
      ? t("meetings.startedRelative", { when: formatRelativeTime(meeting.actual_start_at ?? meeting.starts_at, locale) })
      : ended
        ? t("meetings.endedRelative", { when: formatRelativeTime(meeting.actual_end_at ?? meeting.ends_at, locale) })
        : canceled && canceledAt
          ? t("meetings.canceledAt", { time: formatMeetingStart(canceledAt, locale) })
          : null;

  const shownPeople = people.slice(0, AVATAR_STACK_LIMIT);
  const morePeople = people.length - shownPeople.length;
  // Nothing left to do from here once the meeting is over or called off.
  const showActions = open;
  const scheduledEnd = formatMeetingStart(meeting.ends_at, locale);

  return (
    <section aria-label={meeting.title} className="rounded-xl border border-surface-border bg-surface shadow-surface">
      <div className="p-5 lg:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <MeetingStatusBadge status={status} />
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
            "mt-3 max-w-4xl text-balance text-display-sm font-semibold text-foreground",
            canceled && "line-through decoration-muted-foreground",
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
            <MeetingPersonAvatar name={host.name} avatarUrl={host.avatarUrl} size="sm" />
            <span className="min-w-0 truncate">
              <span className="font-medium text-foreground">{host.name}</span>
              <span className="text-faint-foreground"> · {t("meetings.host")}</span>
            </span>
          </div>
          {people.length > 0 ? (
            <div className="flex min-w-0 items-center gap-2 text-body text-muted-foreground">
              <Users aria-hidden className="size-4 shrink-0 text-faint-foreground" />
              <AvatarGroup>
                {shownPeople.map((p) => (
                  <MeetingPersonAvatar key={p.id} name={p.name} avatarUrl={p.avatarUrl} size="sm" />
                ))}
                {morePeople > 0 ? (
                  <AvatarGroupCount className="size-6 text-caption">
                    {t("meetings.moreParticipantsShort", { count: morePeople })}
                  </AvatarGroupCount>
                ) : null}
              </AvatarGroup>
            </div>
          ) : null}
        </div>

        {meeting.description ? (
          <p className="mt-4 max-w-prose whitespace-pre-wrap break-words text-pretty text-body text-muted-foreground">
            {meeting.description}
          </p>
        ) : null}

        {overtime ? (
          <Notice
            tone="warning"
            icon={Hourglass}
            layout="inline"
            className="mt-4 flex-wrap"
            action={
              canHost ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={extendPending} onClick={onExtend}>
                    <CalendarClock aria-hidden />
                    {t("meetings.extendWindow")}
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={onEnd}>
                    <PhoneOff aria-hidden />
                    {t("meetings.end")}
                  </Button>
                </div>
              ) : undefined
            }
          >
            {t(canHost ? "meetings.overtimeHostHint" : "meetings.overtimeHint", { time: scheduledEnd })}
          </Notice>
        ) : null}

        {missed ? (
          <Notice
            tone="info"
            icon={CalendarX2}
            layout="inline"
            className="mt-4 flex-wrap"
            action={
              canHost || canCancel ? (
                <div className="flex flex-wrap items-center gap-2">
                  {canHost ? (
                    <MeetingEditDialog
                      workspaceId={workspaceId}
                      meeting={meeting}
                      trigger={
                        <Button type="button" size="sm" variant="outline">
                          <CalendarClock aria-hidden />
                          {t("meetings.reschedule")}
                        </Button>
                      }
                    />
                  ) : null}
                  {canCancel ? (
                    <Button type="button" size="sm" variant="destructive" onClick={onCancel}>
                      <Ban aria-hidden />
                      {t("meetings.cancel")}
                    </Button>
                  ) : null}
                </div>
              ) : undefined
            }
          >
            {t(canHost ? "meetings.missedHostHint" : "meetings.missedHint")}
          </Notice>
        ) : null}

        {!showActions ? null : (
          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {canHost && scheduled ? (
                <Button type="button" size="lg" variant="outline" disabled={startPending} onClick={onStart}>
                  <Play aria-hidden />
                  {t("meetings.start")}
                </Button>
              ) : null}
              {open ? (
                <Button type="button" size="lg" variant="brand" onClick={onJoin}>
                  <Video aria-hidden />
                  {t("meetings.join")}
                  {canHost && pendingJoins > 0 ? (
                    <span className="ml-0.5 rounded-full bg-brand-foreground/20 px-1.5 text-caption font-medium tabular-nums">
                      {t("meetings.pendingCount", { count: pendingJoins })}
                    </span>
                  ) : null}
                </Button>
              ) : null}
              <MeetingCalendarButton meetingId={meeting.id} title={meeting.title} className="text-muted-foreground" />
            </div>
            {myInvite && open ? <MeetingRsvpBar meetingId={meeting.id} invitation={myInvite} /> : null}
          </div>
        )}
      </div>
    </section>
  );
}
