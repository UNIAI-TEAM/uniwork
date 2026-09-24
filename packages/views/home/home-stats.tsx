"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { nextMeetingToday, overdueDays } from "@uniwork/core/home/brief";
import { paths } from "@uniwork/core/paths";
import type { HomeSource, HomeSummary } from "@uniwork/core/types/home";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { meetingLocale } from "../meetings/meeting-datetime";
import { AppLink } from "../navigation";
import { HOME_MARKS, homeMarkTone, type HomeMarkKey } from "./home-marks";
import { clock } from "./home-time";

export type HomeWorkStat = Extract<HomeMarkKey, "due_today" | "overdue">;

/** The source each count is read from; a failed source has no true count. */
const SOURCE: Record<HomeMarkKey, HomeSource> = {
  due_today: "tasks",
  overdue: "tasks",
  meetings_today: "meetings",
  unread: "notifications",
};

const TILE =
  "group flex h-full w-full items-start gap-3 rounded-xl border border-surface-border bg-surface p-3 text-left shadow-[var(--surface-shadow)] sm:p-3.5";
const INTERACTIVE =
  "cursor-pointer transition-[background-color,border-color] duration-150 ease-out hover:border-border hover:bg-surface-hover active:bg-surface-selected";

/**
 * Today at a glance: four tiles counting real records (PRODUCT.md allows
 * metric cards that report the state of the thing on screen). Each number
 * goes to what it counts: overdue and due today move focus to the first such
 * task in My work on this page (the arrow points down, not away), meetings
 * open the meeting list, unread opens the inbox. Under a number sits what it
 * cannot say by itself: how old the oldest overdue task is, when the next
 * meeting starts. A count whose source failed shows a dash and says so,
 * because the server reports it as zero.
 */
export function HomeStats({
  summary,
  loading,
  onShowWork,
}: {
  summary: HomeSummary | undefined;
  loading: boolean;
  /** Present only while My work is on the page. */
  onShowWork?: (stat: HomeWorkStat) => void;
}) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const ws = paths.workspace(workspace.organization_slug, workspace.slug);
  const locale = meetingLocale(i18n.language);
  const counts = summary?.counts;

  const context = (key: HomeMarkKey): string | undefined => {
    if (!summary) return undefined;
    if (key === "overdue") {
      const oldest = summary.my_work.find((task) => overdueDays(summary.today, task.due_date) > 0);
      return oldest ? t("home.stats.oldest", { count: overdueDays(summary.today, oldest.due_date) }) : undefined;
    }
    if (key === "meetings_today") {
      if (summary.upcoming_meetings.some((m) => m.status === "IN_PROGRESS")) return t("home.stats.live");
      const next = nextMeetingToday(summary);
      return next ? t("home.stats.next", { time: clock(next.starts_at, locale, summary.timezone) }) : undefined;
    }
    return undefined;
  };

  const items: { key: HomeMarkKey; href?: string }[] = [
    { key: "due_today" },
    { key: "overdue" },
    { key: "meetings_today", href: ws.meetings() },
    { key: "unread", href: ws.inbox() },
  ];

  return (
    // A size container: in the compact density the tiles get half the width
    // at the same viewport, so the row of four waits for room, not for lg.
    <section aria-label={t("home.stats.label")} className="@container">
      <ul className="grid grid-cols-2 gap-2 sm:gap-3 @3xl:grid-cols-4">
        {items.map(({ key, href }) => {
          const failed = summary?.partial.includes(SOURCE[key]) ?? false;
          const value = counts?.[key] ?? 0;
          const label = t(`home.stats.${key}`);
          const name = failed ? t("home.stats.failed_item", { label }) : t("home.stats.item", { count: value, label });
          const showWork = (key === "overdue" || key === "due_today") && value > 0 && !loading && !failed ? onShowWork : undefined;
          const link = failed ? undefined : href;
          const interactive = Boolean(link || showWork);
          const note = failed ? t("home.stats.failed") : context(key);
          const Arrow = showWork ? ArrowDown : ArrowUpRight;
          const content: ReactNode = (
            <>
              <IconTile
                icon={HOME_MARKS[key].icon}
                tone={loading || failed ? "muted" : homeMarkTone(key, value)}
                className="hidden sm:flex"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                {loading ? (
                  <Skeleton className="my-1 h-6 w-10" />
                ) : (
                  <span
                    data-testid={`home-stat-${key}`}
                    className={cn(
                      "text-display-sm font-semibold tabular-nums",
                      failed ? "text-muted-foreground" : key === "overdue" && value > 0 ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {failed ? "—" : value}
                  </span>
                )}
                <span className="truncate text-label text-muted-foreground first-letter:uppercase">{label}</span>
                {note && !loading ? (
                  <span className={cn("truncate text-caption", failed ? "text-destructive" : "text-muted-foreground")}>{note}</span>
                ) : null}
              </span>
              {interactive ? (
                <Arrow
                  aria-hidden
                  className="size-4 shrink-0 self-start text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              ) : null}
            </>
          );

          return (
            <li key={key} className="min-w-0">
              {link ? (
                <AppLink href={link} aria-label={name} className={cn(TILE, INTERACTIVE)}>
                  {content}
                </AppLink>
              ) : showWork ? (
                <button type="button" aria-label={name} onClick={() => showWork(key as HomeWorkStat)} className={cn(TILE, INTERACTIVE)}>
                  {content}
                </button>
              ) : (
                <div className={TILE}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
