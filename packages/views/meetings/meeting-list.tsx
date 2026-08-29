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
import { formatMeetingDay, formatMeetingTimes, meetingDayKey, meetingLocale } from "./meeting-datetime";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingStatusBadge } from "./meeting-status-badge";

/** Rows grouped by local calendar day, in the order the server returned them. */
export function groupMeetingsByDay(meetings: readonly Meeting[]): { day: string; items: Meeting[] }[] {
  const groups: { day: string; items: Meeting[] }[] = [];
  for (const m of meetings) {
    const day = meetingDayKey(m.starts_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(m);
    else groups.push({ day, items: [m] });
  }
  return groups;
}

const ROW = "grid grid-cols-[5.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto_auto] sm:gap-4";

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
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-4 w-48 max-w-full" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
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
}: {
  workspaceId: string;
  meetings: Meeting[];
  onOpenRoom: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const locale = meetingLocale(i18n.language);
  const { data: members } = useMembers(workspaceId);
  const hostName = (id?: string) => members?.find((m) => m.user_id === id)?.display_name ?? t("meetings.host");
  const today = meetingDayKey(new Date().toISOString());

  return (
    <div className="space-y-6">
      {groupMeetingsByDay(meetings).map((group) => (
        <section key={group.day} aria-labelledby={`meeting-day-${group.day}`}>
          <h2 id={`meeting-day-${group.day}`} className="mb-2 flex items-baseline gap-2 text-label font-medium text-foreground">
            {formatMeetingDay(group.day, locale)}
            {group.day === today ? <span className="text-caption font-normal text-muted-foreground">{t("meetings.today")}</span> : null}
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {group.items.map((m) => {
              const host = hostName(m.host_user_id ?? m.created_by);
              const live = m.status === "IN_PROGRESS";
              return (
                <li key={m.id} className="relative">
                  <AppLink
                    href={ws.meeting(m.id)}
                    className={`${ROW} rounded-lg outline-none transition-colors duration-100 hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50`}
                  >
                    <span className="whitespace-nowrap text-label tabular-nums text-muted-foreground">
                      {formatMeetingTimes(m.starts_at, m.ends_at, m.timezone, locale)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-body font-medium text-foreground">{m.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground">
                        <MeetingPersonAvatar name={host} className="size-4 text-[9px]" />
                        <span className="truncate">{host}</span>
                      </span>
                    </span>
                    <MeetingStatusBadge status={m.status} />
                    {/* Reserve the join column on wide rows so badges stay aligned. */}
                    <span className="hidden w-24 sm:block" aria-hidden />
                  </AppLink>
                  {live ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="brand"
                      className="absolute top-1/2 right-3 hidden -translate-y-1/2 sm:inline-flex"
                      onClick={() => onOpenRoom(m.id)}
                    >
                      <Video aria-hidden className="size-3.5" />
                      {t("meetings.joinNow")}
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
