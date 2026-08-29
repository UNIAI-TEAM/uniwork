"use client";
import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { Meeting } from "@uniwork/core/types";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { cn } from "@uniwork/ui/lib/utils";
import {
  formatMeetingDay,
  formatMeetingTimes,
  meetingDayKey,
  meetingLocale,
} from "./meeting-datetime";
import { MeetingStatusBadge } from "./meeting-status-badge";

/**
 * Rows grouped by the viewer's calendar day. Days keep the server's order
 * (upcoming ascending, then past descending); a day that holds both an
 * upcoming and an ended meeting — today — is merged into one group and its
 * rows run chronologically.
 */
export function groupMeetingsByDay(
  meetings: readonly Meeting[],
): { day: string; items: Meeting[] }[] {
  const byDay = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const day = meetingDayKey(m.starts_at);
    const items = byDay.get(day);
    if (items) items.push(m);
    else byDay.set(day, [m]);
  }
  return [...byDay].map(([day, items]) => ({
    day,
    items: items.sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
  }));
}

// Time + text; the status badge sits on the meta line. ≥sm reserves a join column so rows align.
const ROW =
  "grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-3 px-3 py-2.5 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:gap-4";

export function MeetingListSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      {[3, 2].map((rows, g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <div className="divide-y divide-border rounded-lg border border-border bg-surface">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className={ROW}>
                <Skeleton className="h-4 w-16" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-48 max-w-full" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <span className="hidden w-24 sm:block" aria-hidden />
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
  const hostName = (id?: string) =>
    members?.find((m) => m.user_id === id)?.display_name ??
    t("meetings.hostUnknown");
  const today = meetingDayKey(new Date().toISOString());

  return (
    <div className={cn("space-y-6", className)}>
      {groupMeetingsByDay(meetings).map((group) => (
        <section key={group.day} aria-labelledby={`meeting-day-${group.day}`}>
          <h2
            id={`meeting-day-${group.day}`}
            className="mb-2 flex items-baseline gap-2 text-label font-medium text-foreground"
          >
            {formatMeetingDay(group.day, locale)}
            {group.day === today ? (
              <span className="text-caption font-normal text-muted-foreground">
                {t("meetings.today")}
              </span>
            ) : null}
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {group.items.map((m) => {
              const host = hostName(m.host_user_id ?? m.created_by);
              const live = m.status === "IN_PROGRESS";
              return (
                <li key={m.id} className="relative">
                  <AppLink
                    href={ws.meeting(m.id)}
                    className={cn(
                      ROW,
                      "rounded-lg outline-none transition-colors duration-100 hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      live && "pr-16 sm:pr-3",
                    )}
                  >
                    <span className="whitespace-nowrap text-label tabular-nums text-muted-foreground">
                      {/* Same clock as the day heading: the viewer's, not the meeting's stored zone. */}
                      {formatMeetingTimes(m.starts_at, m.ends_at, locale)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-body font-medium text-foreground">
                        {m.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-caption text-muted-foreground">
                        <span className="truncate">{host}</span>
                        <MeetingStatusBadge status={m.status} />
                      </span>
                    </span>
                    {/* Reserve the join column on wide rows so titles stay aligned. */}
                    <span className="hidden w-24 sm:block" aria-hidden />
                  </AppLink>
                  {live ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="brand"
                      aria-label={t("meetings.joinNow")}
                      className="absolute top-1/2 right-2 size-11 -translate-y-1/2 px-0 sm:right-3 sm:h-7 sm:w-auto sm:px-2.5"
                      onClick={() => onOpenRoom(m.id)}
                    >
                      <Video aria-hidden className="size-4 sm:size-3.5" />
                      <span className="hidden sm:inline">
                        {t("meetings.joinNow")}
                      </span>
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
