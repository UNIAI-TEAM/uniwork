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

/** Newest-created first; falls back to ULID id when created_at is absent. */
function meetingCreatedSortKey(m: Meeting): string {
  return m.created_at ?? m.id;
}

/**
 * Rows grouped by the viewer's calendar day. Days keep the server's order
 * (created_at descending); within a day, rows also run newest-created-first.
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
    items: items.sort((a, b) =>
      meetingCreatedSortKey(b).localeCompare(meetingCreatedSortKey(a)),
    ),
  }));
}

const MOBILE_ROW =
  "grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 sm:grid-cols-[5rem_minmax(0,1fr)_auto]";

export function MeetingListSkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      {[3, 2].map((rows, g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="hidden border-b border-border lg:block">
              <div className="flex gap-3 py-2 text-caption">
                <Skeleton className="ml-4 h-3 w-8" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-14" />
              </div>
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className={MOBILE_ROW}>
                  <Skeleton className="ml-4 h-4 w-16" />
                  <Skeleton className="h-4 w-48 max-w-full" />
                  <Skeleton className="mr-4 h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MeetingDayTable({
  items,
  hostName,
  ws,
  locale,
  onOpenRoom,
  t,
}: {
  items: Meeting[];
  hostName: (id?: string) => string;
  ws: ReturnType<typeof paths.workspace>;
  locale: string;
  onOpenRoom: (id: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <table className="hidden w-full border-collapse text-body lg:table">
      <thead>
        <tr className="border-b border-border text-left text-caption text-muted-foreground">
          <th scope="col" className="w-[5.5rem] py-2 pl-4 pr-3 font-medium">
            {t("meetings.colTime")}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            {t("meetings.colTitle")}
          </th>
          <th scope="col" className="w-40 py-2 pr-3 font-medium">
            {t("meetings.colHost")}
          </th>
          <th scope="col" className="w-32 py-2 pr-3 font-medium">
            {t("meetings.status")}
          </th>
          <th scope="col" className="w-24 py-2 pr-4 font-medium">
            <span className="sr-only">{t("meetings.join")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((m) => {
          const host = hostName(m.host_user_id ?? m.created_by);
          const live = m.status === "IN_PROGRESS";
          return (
            <tr
              key={m.id}
              className={cn(
                "border-b border-border last:border-0",
                "transition-colors duration-100 hover:bg-surface-hover",
                live && "bg-brand/5 hover:bg-brand/10",
              )}
            >
              <td className="whitespace-nowrap py-2.5 pl-4 pr-3 text-label tabular-nums text-muted-foreground">
                {formatMeetingTimes(m.starts_at, m.ends_at, locale)}
              </td>
              <td className="max-w-0 py-2.5 pr-3">
                <AppLink
                  href={ws.meeting(m.id)}
                  className="block truncate font-medium text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {m.title}
                </AppLink>
              </td>
              <td className="max-w-0 py-2.5 pr-3">
                <span className="block truncate text-muted-foreground">{host}</span>
              </td>
              <td className="py-2.5 pr-3">
                <MeetingStatusBadge status={m.status} />
              </td>
              <td className="py-2.5 pr-4 text-right">
                {live ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="brand"
                    aria-label={t("meetings.joinNow")}
                    className="h-7 px-2.5"
                    onClick={() => onOpenRoom(m.id)}
                  >
                    <Video aria-hidden className="size-3.5" />
                    <span>{t("meetings.joinNow")}</span>
                  </Button>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MeetingDayMobileList({
  items,
  hostName,
  ws,
  locale,
  onOpenRoom,
  t,
}: {
  items: Meeting[];
  hostName: (id?: string) => string;
  ws: ReturnType<typeof paths.workspace>;
  locale: string;
  onOpenRoom: (id: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <ul className="divide-y divide-border lg:hidden">
      {items.map((m) => {
        const host = hostName(m.host_user_id ?? m.created_by);
        const live = m.status === "IN_PROGRESS";
        return (
          <li
            key={m.id}
            className={cn(
              MOBILE_ROW,
              "relative transition-colors duration-100 hover:bg-surface-hover focus-within:ring-[3px] focus-within:ring-ring/50 focus-within:ring-inset",
              live && "bg-brand/5 hover:bg-brand/10",
            )}
          >
            {live ? (
              <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-brand" />
            ) : null}
            <span className="pl-4 whitespace-nowrap text-label tabular-nums text-muted-foreground">
              {formatMeetingTimes(m.starts_at, m.ends_at, locale)}
            </span>
            <AppLink href={ws.meeting(m.id)} className="min-w-0 outline-none">
              <span className="block truncate text-body font-medium text-foreground">
                {m.title}
              </span>
              <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                {host}
              </span>
            </AppLink>
            <span className="pr-4">
              {live ? (
                <Button
                  type="button"
                  size="sm"
                  variant="brand"
                  aria-label={t("meetings.joinNow")}
                  className="size-11 px-0 sm:h-7 sm:w-auto sm:px-2.5"
                  onClick={() => onOpenRoom(m.id)}
                >
                  <Video aria-hidden className="size-4 sm:size-3.5" />
                  <span className="hidden sm:inline">{t("meetings.joinNow")}</span>
                </Button>
              ) : (
                <MeetingStatusBadge status={m.status} />
              )}
            </span>
          </li>
        );
      })}
    </ul>
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
          <div className="mb-2 flex items-baseline gap-2">
            <h2
              id={`meeting-day-${group.day}`}
              className="shrink-0 text-label font-semibold text-foreground"
            >
              {formatMeetingDay(group.day, locale)}
            </h2>
            {group.day === today ? (
              <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-caption font-medium text-brand">
                {t("meetings.today")}
              </span>
            ) : null}
            <div aria-hidden className="h-px min-w-6 flex-1 bg-border" />
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <MeetingDayTable
              items={group.items}
              hostName={hostName}
              ws={ws}
              locale={locale}
              onOpenRoom={onOpenRoom}
              t={t}
            />
            <MeetingDayMobileList
              items={group.items}
              hostName={hostName}
              ws={ws}
              locale={locale}
              onOpenRoom={onOpenRoom}
              t={t}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
