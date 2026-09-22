"use client";
import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { displayMeetingStatus, isScheduledMeetingLive } from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import type { Meeting } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { formatMeetingDay, formatMeetingTimes, meetingDayKey, meetingLocale } from "./meeting-datetime";
import { MeetingListRecordingButton } from "./meeting-list-recording-button";
import { MeetingPersonAvatar } from "./meeting-person";
import { formatRelativeTime } from "./meeting-relative-time";
import { MEETING_STATUS_TONE, MeetingStatusBadge, ToneBadge } from "./meeting-status-badge";
import { useNow } from "./use-now";

function startMs(m: Meeting): number {
  const t = Date.parse(m.starts_at);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Rows grouped by the viewer's calendar day, in the order a person reads a
 * calendar: today and the days ahead first, soonest first; then the days
 * already behind, most recent first. Within a day, rows run by start time
 * (id breaks a tie so a refetch never reshuffles them). The list API's
 * `sort=starts_at` pages in this same order, so paging never scatters a day.
 */
export function groupMeetingsByDay(
  meetings: readonly Meeting[],
  today: string = meetingDayKey(new Date().toISOString()),
): { day: string; items: Meeting[] }[] {
  const byDay = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const day = meetingDayKey(m.starts_at);
    const items = byDay.get(day);
    if (items) items.push(m);
    else byDay.set(day, [m]);
  }
  const days = [...byDay.keys()];
  const ahead = days.filter((d) => d >= today).sort();
  const behind = days.filter((d) => d < today).sort().reverse();
  return [...ahead, ...behind].map((day) => ({
    day,
    items: byDay.get(day)!.sort((a, b) => startMs(a) - startMs(b) || a.id.localeCompare(b.id)),
  }));
}

/** The calendar day `n` days from `dayKey` ("2026-08-28" → "2026-08-29"). */
function shiftDay(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + n);
  return meetingDayKey(d.toISOString());
}

/** Wall-clock time in the viewer's zone, the same clock `formatMeetingTimes` reads. */
function clock(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

/** A relative start is worth a chip only while it is close enough to plan the day around. */
const SOON_MS = 12 * 3_600_000;

/**
 * One row, the same at every width: time, a rail, the host, the title with a
 * line of meta, and the state on the right. The title link stretches over the
 * whole row; the join and rewatch buttons sit above that overlay.
 */
const ROW =
  "relative flex min-h-12 items-center gap-3 px-3 py-1.5 transition-colors duration-micro hover:bg-surface-hover focus-within:bg-surface-selected";

/**
 * The rail repeats the badge's signal (upcoming info, live success, overtime
 * warning) so the two never disagree; what is over, missed or canceled goes
 * quiet. A state is a signal, never the meetings tint.
 */
function railClass(display: string): string {
  switch (MEETING_STATUS_TONE[display]) {
    case "info":
      return "bg-info";
    case "success":
      return "bg-success";
    case "warning":
      return "bg-warning";
    default:
      return "bg-border";
  }
}

function MeetingRow({
  meeting: m,
  host,
  href,
  locale,
  nowMs,
  onOpenRoom,
}: {
  meeting: Meeting;
  host: { name: string; avatarUrl?: unknown };
  href: string;
  locale: string;
  nowMs: number;
  onOpenRoom: (id: string) => void;
}) {
  const { t } = useTranslation();
  const display = displayMeetingStatus(m, nowMs);
  const live = isScheduledMeetingLive(m, nowMs);
  const rewatch = m.status === "ENDED" && m.has_playable_recording === true;
  const untilStart = startMs(m) - nowMs;
  const soon = display === "SCHEDULED" && untilStart > 0 && untilStart < SOON_MS;
  const instant = m.meeting_type === "INSTANT";

  return (
    <li className={ROW}>
      {/* The time column is for the eye; the link carries the same span as text. */}
      <span aria-hidden className="flex w-11 shrink-0 flex-col text-right tabular-nums">
        <span className="text-label font-semibold text-foreground">{clock(m.starts_at, locale)}</span>
        <span className="text-caption text-muted-foreground">{clock(m.ends_at, locale)}</span>
      </span>
      <span aria-hidden className={cn("w-1 self-stretch rounded-full", railClass(display))} />
      <MeetingPersonAvatar name={host.name} avatarUrl={host.avatarUrl} className="max-sm:hidden" />
      <div className="min-w-0 flex-1">
        {/* Two lines on a phone so a long title is still readable; one from sm, where the row is wide. */}
        <AppLink
          href={href}
          title={m.title}
          className="block rounded-sm text-body font-medium text-foreground after:absolute after:inset-0 max-sm:line-clamp-2 max-sm:break-words sm:truncate"
        >
          {m.title}
          <span className="sr-only">, {formatMeetingTimes(m.starts_at, m.ends_at, locale)}</span>
        </AppLink>
        <p className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <span className="truncate">{host.name}</span>
          {instant ? (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0">{t("meetings.type_INSTANT")}</span>
            </>
          ) : null}
          {soon ? (
            <ToneBadge tone="info" className="shrink-0">
              {formatRelativeTime(m.starts_at, locale, nowMs)}
            </ToneBadge>
          ) : null}
        </p>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-2">
        <MeetingStatusBadge status={display} className={cn(live && "max-sm:hidden")} />
        {rewatch ? <MeetingListRecordingButton meetingId={m.id} /> : null}
        {live ? (
          <Button
            type="button"
            size="sm"
            variant="brand"
            className="max-sm:w-7 max-sm:px-0"
            onClick={() => onOpenRoom(m.id)}
          >
            <Video aria-hidden />
            <span className="max-sm:sr-only">{t("meetings.joinNow")}</span>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** The loading shape is the row's shape: a day heading, then framed rows of time, rail, face, title and state. */
export function MeetingListSkeleton() {
  const { t } = useTranslation();
  const widths = ["w-2/3", "w-1/2", "w-3/5"];
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{t("meetings.listLoading")}</span>
      {[3, 2].map((rows, g) => (
        <div key={g} aria-hidden>
          <div className="py-1.5">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex min-h-12 items-center gap-3 px-3 py-1.5">
                <div className="flex w-11 shrink-0 flex-col items-end gap-1">
                  <Skeleton className="h-3.5 w-9" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="w-1 self-stretch rounded-full" />
                <Skeleton className="size-6 shrink-0 rounded-full max-sm:hidden" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className={cn("h-3.5 max-w-full", widths[(g + i) % widths.length])} />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MeetingList({
  workspaceId,
  meetings,
  onOpenRoom,
  className,
}: {
  workspaceId: string;
  meetings: Meeting[];
  onOpenRoom: (id: string) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const locale = meetingLocale(i18n.language);
  const { data: members } = useMembers(workspaceId);
  const hostOf = (id?: string) => {
    const member = members?.find((m) => m.user_id === id);
    return { name: member?.display_name ?? t("meetings.hostUnknown"), avatarUrl: member?.avatar_url };
  };
  const nowMs = useNow();
  const today = meetingDayKey(new Date(nowMs).toISOString());
  const relative: Record<string, string> = {
    [today]: t("meetings.today"),
    [shiftDay(today, 1)]: t("meetings.tomorrow"),
    [shiftDay(today, -1)]: t("meetings.yesterday"),
  };

  return (
    <div className={cn("space-y-4", className)}>
      {groupMeetingsByDay(meetings, today).map((group) => {
        const date = formatMeetingDay(group.day, locale);
        const near = relative[group.day];
        return (
          <section key={group.day} aria-labelledby={`meeting-day-${group.day}`}>
            <h2
              id={`meeting-day-${group.day}`}
              className="sticky top-0 z-20 flex items-center gap-2 bg-background py-1.5 text-overline text-muted-foreground"
            >
              {near ? (
                <>
                  <span className="text-foreground">{near}</span>
                  <span>{date}</span>
                </>
              ) : (
                <span>{date}</span>
              )}
              <span aria-hidden className="min-w-5 rounded-sm bg-muted px-1 text-center tabular-nums">
                {group.items.length}
              </span>
              <span className="sr-only">{t("meetings.dayCount", { count: group.items.length })}</span>
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {group.items.map((m) => (
                <MeetingRow
                  key={m.id}
                  meeting={m}
                  host={hostOf(m.host_user_id ?? m.created_by)}
                  href={ws.meeting(m.id)}
                  locale={locale}
                  nowMs={nowMs}
                  onOpenRoom={onOpenRoom}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
