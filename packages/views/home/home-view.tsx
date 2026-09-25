"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { House, LayoutDashboard, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { buildHomeHeadline, oldestOverdue } from "@uniwork/core/home/brief";
import { useHomePrefs, useHomeSummary } from "@uniwork/core/home";
import { greetingName } from "@uniwork/core/home/greeting";
import { visibleSections, type HomeLayout, type HomeSectionKey } from "@uniwork/core/home/prefs";
import { paths } from "@uniwork/core/paths";
import type { HomeSummary } from "@uniwork/core/types/home";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { CollectionPageHeader, CollectionPageHeaderAction, CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";
import { useWorkspace } from "../layout/workspace-context";
import { formatMeetingDay, meetingDayKey, meetingLocale } from "../meetings/meeting-datetime";
import { AppLink } from "../navigation";
import { HomeCustomizePanel } from "./home-customize-panel";
import { HomeInbox } from "./home-inbox";
import { homeBands, isHomeAside } from "./home-layout";
import { HomeMyWork } from "./home-my-work";
import { HomeStart } from "./home-start";
import { HomeStats, type HomeWorkStat } from "./home-stats";
import { clock, hourIn } from "./home-time";
import { HomeUpcoming } from "./home-upcoming";

function greetingKey(hour: number): "morning" | "noon" | "afternoon" | "evening" {
  if (hour < 11) return "morning";
  if (hour < 14) return "noon";
  if (hour < 18) return "afternoon";
  return "evening";
}

/**
 * The day, a greeting on the person's own clock, and one sentence naming what
 * to look at first — a title or a time the tiles below cannot show. A meeting
 * in progress gets its join link right here, where the eye lands first.
 */
function HomeGreeting({ name, summary, loading }: { name: string; summary: HomeSummary | undefined; loading: boolean }) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const locale = meetingLocale(i18n.language);
  const headline = summary ? buildHomeHeadline(summary) : null;
  // The server's "today" is in the person's zone; before it arrives, the browser's day.
  const day = formatMeetingDay(summary?.today ?? meetingDayKey(new Date().toISOString()), locale);
  const roomHref = headline?.liveMeetingId
    ? paths.workspace(workspace.organization_slug, workspace.slug).room(headline.liveMeetingId)
    : undefined;
  return (
    <div>
      <p className="text-label text-muted-foreground first-letter:uppercase">{day}</p>
      <h2 className="mt-1 text-display-sm font-semibold text-balance text-foreground">
        {t(`home.greeting.${greetingKey(hourIn(summary?.timezone))}`, { name: greetingName(name) })}
      </h2>
      {headline ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="max-w-prose text-body-lg text-pretty text-muted-foreground">
            {t(headline.key, {
              ...headline.params,
              ...(headline.at ? { time: clock(headline.at, locale, summary?.timezone) } : {}),
            })}
          </p>
          {roomHref ? (
            <AppLink href={roomHref} className={cn(buttonVariants({ size: "sm" }))}>
              {t("home.upcoming.join")}
            </AppLink>
          ) : null}
        </div>
      ) : loading ? (
        <Skeleton className="mt-2 h-5 w-72 max-w-full" />
      ) : null}
    </div>
  );
}

/** The page's reading width per density: wide is for big screens, so it may use them. */
const MAX_WIDTH: Record<HomeLayout, string> = {
  compact: "max-w-3xl",
  balanced: "max-w-7xl",
  wide: "max-w-[100rem]",
};

/**
 * Stand-in while the saved layout loads, so the page does not draw the
 * default density and then jump to the person's own.
 */
function HomeLayoutPending() {
  return (
    <div aria-hidden className="space-y-4">
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}

/** Nothing assigned, scheduled or unread, and every source answered. */
function isQuiet(summary: HomeSummary): boolean {
  const { counts } = summary;
  return (
    summary.partial.length === 0 &&
    summary.my_work.length === 0 &&
    summary.upcoming_meetings.length === 0 &&
    summary.inbox.length === 0 &&
    counts.open + counts.overdue + counts.due_today + counts.meetings_today + counts.unread === 0
  );
}

/**
 * The workspace home: today at a glance, the viewer's open work, meetings and
 * unread notifications, arranged by the viewer's own layout. One request
 * feeds every section; a failed source is labelled where it shows while the
 * others keep working. A workspace with nothing waiting gets first steps
 * instead of empty lists.
 */
export function HomeView() {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  const summaryQuery = useHomeSummary(workspace.id);
  const { prefs, loading: prefsLoading, saving, failed, update, reset } = useHomePrefs(workspace.id);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    if (failed) toast.error(t("home.customize.save_failed"));
  }, [failed, t]);

  const summary = summaryQuery.data ?? undefined;
  const loading = summaryQuery.isPending;
  const retrying = summaryQuery.isFetching;
  const retry = () => void summaryQuery.refetch();
  const unusable = summaryQuery.isError || summaryQuery.data === null;
  const visible = visibleSections(prefs);
  const lists = visible.some((key) => key !== "stats");
  const quiet = summary !== undefined && lists && isQuiet(summary);

  const resetLayout = () => {
    const before = prefs;
    reset();
    toast(t("home.customize.reset_done"), { action: { label: t("home.customize.undo"), onClick: () => update(before) } });
  };

  // Overdue and due today have no filtered list elsewhere to land on, so they
  // land on the first such task in My work here.
  const showWork = (stat: HomeWorkStat) => {
    if (!summary) return;
    const target =
      stat === "overdue"
        ? oldestOverdue(summary)
        : summary.my_work.find((task) => task.status !== "done" && task.due_date === summary.today);
    const link = target ? document.querySelector<HTMLElement>(`[data-task-id="${target.id}"] a`) : null;
    if (link) link.focus();
    else document.getElementById("home-mywork")?.scrollIntoView({ block: "start" });
  };

  const sectionProps = { summary, loading, retrying, onRetry: retry };
  const sections: Record<HomeSectionKey, ReactNode> = {
    stats: <HomeStats summary={summary} loading={loading} onShowWork={visible.includes("mywork") ? showWork : undefined} />,
    mywork: <HomeMyWork {...sectionProps} />,
    upcoming: <HomeUpcoming {...sectionProps} />,
    inbox: <HomeInbox {...sectionProps} />,
  };

  // Every band keeps the saved order in the DOM; the columns appear once the
  // page itself (not the viewport) has room, so a collapsed sidebar counts.
  const grid = homeBands(visible, prefs.layout).map((band) => {
    if (band.kind === "row") {
      return (
        <div key={band.key} className="min-w-0">
          {sections[band.key]}
        </div>
      );
    }
    if (band.kind === "split") {
      return (
        <div
          key={`split-${band.keys[0]}`}
          style={{ "--home-aside-rows": band.asideRows } as CSSProperties}
          className="grid gap-4 @5xl/home:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] @5xl/home:grid-rows-[repeat(var(--home-aside-rows),auto)_1fr] @5xl/home:items-start"
        >
          {band.keys.map((key) => (
            <div
              key={key}
              className={cn("min-w-0", isHomeAside(key) ? "@5xl/home:col-start-2" : "@5xl/home:col-start-1 @5xl/home:row-span-full")}
            >
              {sections[key]}
            </div>
          ))}
        </div>
      );
    }
    return (
      <div
        key={`columns-${band.keys[0]}`}
        style={{ "--home-columns": band.template } as CSSProperties}
        className="grid gap-4 @5xl/home:grid-cols-[var(--home-columns)] @5xl/home:items-start"
      >
        {band.keys.map((key) => (
          <div key={key} className="min-w-0">
            {sections[key]}
          </div>
        ))}
      </div>
    );
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CollectionPageHeader
        icon={House}
        tone={moduleTone("home")}
        title={t("home.title")}
        actions={
          <CollectionPageHeaderAction
            icon={SlidersHorizontal}
            label={t("home.actions.customize")}
            aria-haspopup="dialog"
            aria-expanded={customizing}
            onClick={() => setCustomizing(true)}
          />
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("@container/home mx-auto w-full space-y-5 px-4 pt-5 pb-10 md:px-6", MAX_WIDTH[prefs.layout])}>
          {prefsLoading ? (
            <HomeLayoutPending />
          ) : (
            <HomeGreeting name={user.display_name} summary={summary} loading={loading} />
          )}
          {prefsLoading ? null : unusable ? (
            <div className="rounded-xl border border-surface-border bg-surface">
              <CollectionPageState
                role="alert"
                icon={TriangleAlert}
                tone="destructive"
                title={t("home.error.title")}
                description={t("home.error.description")}
                className="py-12"
                actions={
                  <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={retry}>
                    {t("home.error.retry")}
                  </Button>
                }
              />
            </div>
          ) : visible.length === 0 ? (
            <div role="status" className="rounded-xl border border-dashed border-border">
              <CollectionPageState
                icon={LayoutDashboard}
                title={t("home.customize.all_hidden")}
                description={t("home.customize.all_hidden_hint")}
                className="py-12"
                actions={
                  <Button type="button" variant="outline" size="sm" onClick={() => setCustomizing(true)}>
                    {t("home.customize.open")}
                  </Button>
                }
              />
            </div>
          ) : quiet ? (
            <HomeStart />
          ) : (
            <div className="space-y-4">{grid}</div>
          )}
        </div>
      </div>
      <HomeCustomizePanel
        open={customizing}
        prefs={prefs}
        saving={saving}
        onChange={update}
        onReset={resetLayout}
        onClose={() => setCustomizing(false)}
      />
    </div>
  );
}
